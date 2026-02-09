/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.x — SLA ENFORCEMENT SERVICE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Real-time SLA breach detection and classification.
 * Applied automatically to executions based on SLA policies.
 *
 * SLA LIFECYCLE:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. On execution creation → Apply SLA policy & start timers
 * 2. On execution progress → Check containment SLA
 * 3. On execution completion → Check resolution SLA
 * 4. On SLA breach → Classify breach reason & record
 *
 * BREACH CLASSIFICATION LOGIC:
 * ─────────────────────────────────────────────────────────────────────────────
 * - automation_failure: Step failed with error
 * - external_dependency_delay: Connector timeout or API failure
 * - manual_intervention_delay: Approval took too long
 * - resource_exhaustion: System overload (not yet implemented)
 *
 * VERSION: 1.0.0
 * AUTHOR: SOC Metrics & SLA Architect
 * ══════════════════════════════════════════════════════════════════════════════
 */

import mongoose from 'mongoose';
import Execution, { ExecutionState, StepState } from '../models/execution.js';
import SLAPolicy from '../models/sla-policy.js';
import SOCHealthAlert, { SOCHealthAlertType, AlertSeverity } from '../models/soc-health-alert.js';
import logger from '../utils/logger.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SLA POLICY APPLICATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Apply SLA policy to a new execution
 * Called immediately after execution creation
 *
 * @param {object} execution - Execution document
 * @returns {Promise<object>} - Updated execution with SLA tracking
 */
export async function applySLAPolicy(execution) {
  try {
    // Get alert severity from trigger_data
    const severity = execution.trigger_data?.severity;

    // Find applicable SLA policy
    const policy = await SLAPolicy.findApplicablePolicy(execution.playbook_id, severity);

    if (!policy) {
      // No policy found - create default global policy
      const defaultPolicy = await SLAPolicy.getOrCreateGlobalPolicy();
      return await applySLAPolicyToExecution(execution, defaultPolicy);
    }

    return await applySLAPolicyToExecution(execution, policy);
  } catch (error) {
    logger.error(`Failed to apply SLA policy to execution ${execution.execution_id}:`, error);
    // Don't fail the execution - just log and continue
    return execution;
  }
}

/**
 * Apply a specific SLA policy to an execution
 */
async function applySLAPolicyToExecution(execution, policy) {
  execution.sla_policy_id = policy.policy_id;

  // Initialize SLA status tracking
  execution.sla_status = {
    acknowledge: {
      threshold_ms: policy.thresholds.acknowledge_ms,
      actual_ms: null,
      breached: false
    },
    containment: {
      threshold_ms: policy.thresholds.containment_ms,
      actual_ms: null,
      breached: false
    },
    resolution: {
      threshold_ms: policy.thresholds.resolution_ms,
      actual_ms: null,
      breached: false
    },
    breach_reason: null
  };

  // Calculate acknowledge SLA (webhook_received_at → acknowledged_at)
  if (execution.webhook_received_at && execution.acknowledged_at) {
    const ackTime = execution.acknowledged_at - execution.webhook_received_at;
    execution.sla_status.acknowledge.actual_ms = ackTime;
    execution.sla_status.acknowledge.breached = ackTime > policy.thresholds.acknowledge_ms;
  }

  await execution.save();

  logger.info(`Applied SLA policy ${policy.policy_id} to execution ${execution.execution_id}`);

  return execution;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLA BREACH CHECKING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check containment SLA when first containment action occurs
 *
 * @param {string} executionId - Execution ID
 * @param {Date} containmentTime - Time of first containment action
 * @returns {Promise<object>} - Updated execution
 */
export async function checkContainmentSLA(executionId, containmentTime = new Date()) {
  try {
    const execution = await Execution.findOne({ execution_id: executionId });

    if (!execution || !execution.sla_policy_id) {
      return execution;
    }

    // Set containment timestamp if not already set
    if (!execution.containment_at) {
      execution.containment_at = containmentTime;
    }

    // Calculate containment time
    const containmentDuration = execution.containment_at - execution.started_at;
    execution.sla_status.containment.actual_ms = containmentDuration;

    // Check breach
    const threshold = execution.sla_status.containment.threshold_ms;
    execution.sla_status.containment.breached = containmentDuration > threshold;

    if (execution.sla_status.containment.breached) {
      logger.warn(`Containment SLA breached for execution ${executionId}: ${containmentDuration}ms > ${threshold}ms`);

      // Classify breach reason
      execution.sla_status.breach_reason = await classifyBreachReason(execution);
    }

    await execution.save();

    return execution;
  } catch (error) {
    logger.error(`Failed to check containment SLA for execution ${executionId}:`, error);
    throw error;
  }
}

/**
 * Check resolution SLA when execution reaches terminal state
 *
 * @param {string} executionId - Execution ID
 * @returns {Promise<object>} - Updated execution
 */
export async function checkResolutionSLA(executionId) {
  try {
    const execution = await Execution.findOne({ execution_id: executionId });

    if (!execution || !execution.sla_policy_id) {
      return execution;
    }

    // Only check if in terminal state
    if (![ExecutionState.COMPLETED, ExecutionState.FAILED].includes(execution.state)) {
      return execution;
    }

    // Calculate resolution time
    if (execution.started_at && execution.completed_at) {
      const resolutionDuration = execution.completed_at - execution.started_at;
      execution.sla_status.resolution.actual_ms = resolutionDuration;

      // Check breach
      const threshold = execution.sla_status.resolution.threshold_ms;
      execution.sla_status.resolution.breached = resolutionDuration > threshold;

      if (execution.sla_status.resolution.breached) {
        logger.warn(`Resolution SLA breached for execution ${executionId}: ${resolutionDuration}ms > ${threshold}ms`);

        // Classify breach reason if not already classified
        if (!execution.sla_status.breach_reason) {
          execution.sla_status.breach_reason = await classifyBreachReason(execution);
        }

        // Create SOC health alert for SLA breach
        await createSLABreachAlert(execution);
      }

      await execution.save();
    }

    return execution;
  } catch (error) {
    logger.error(`Failed to check resolution SLA for execution ${executionId}:`, error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BREACH REASON CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Classify the reason for SLA breach
 *
 * @param {object} execution - Execution document
 * @returns {Promise<string>} - Breach reason classification
 */
async function classifyBreachReason(execution) {
  // Check for automation failure (step failed)
  const failedSteps = execution.steps.filter(s => s.state === StepState.FAILED);
  if (failedSteps.length > 0) {
    return 'automation_failure';
  }

  // Check for external dependency delay (connector timeout)
  const slowSteps = execution.steps.filter(s => {
    return s.duration_ms && s.duration_ms > 30000 && // Step took > 30s
           s.error && (
             s.error.code?.includes('TIMEOUT') ||
             s.error.code?.includes('ECONNREFUSED') ||
             s.error.code?.includes('ETIMEDOUT')
           );
  });

  if (slowSteps.length > 0) {
    return 'external_dependency_delay';
  }

  // Check for manual intervention delay (approval)
  if (execution.approval_id) {
    return 'manual_intervention_delay';
  }

  // Default to external dependency delay if no specific cause found
  return 'external_dependency_delay';
}

// ═══════════════════════════════════════════════════════════════════════════════
// SOC HEALTH ALERTING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create SOC health alert for SLA breach
 *
 * @param {object} execution - Execution document
 */
async function createSLABreachAlert(execution) {
  try {
    const severity = execution.trigger_data?.severity || 'unknown';
    const breachType = execution.sla_status.resolution.breached ? 'resolution' :
                       execution.sla_status.containment.breached ? 'containment' : 'acknowledge';

    const message = `SLA breach detected for execution ${execution.execution_id} (${execution.playbook_name}): ` +
                    `${breachType} SLA exceeded by ${execution.sla_status[breachType].actual_ms - execution.sla_status[breachType].threshold_ms}ms. ` +
                    `Reason: ${execution.sla_status.breach_reason}`;

    await SOCHealthAlert.createOrIncrement({
      type: SOCHealthAlertType.SLA_BREACH_SPIKE,
      severity: severity === 'critical' ? AlertSeverity.HIGH : AlertSeverity.MEDIUM,
      title: `${breachType.toUpperCase()} SLA Breach`,
      message,
      context: {
        execution_id: execution.execution_id,
        playbook_id: execution.playbook_id,
        playbook_name: execution.playbook_name,
        breach_type: breachType,
        breach_reason: execution.sla_status.breach_reason,
        actual_ms: execution.sla_status[breachType].actual_ms,
        threshold_ms: execution.sla_status[breachType].threshold_ms,
        overage_ms: execution.sla_status[breachType].actual_ms - execution.sla_status[breachType].threshold_ms
      },
      resource_type: 'execution',
      resource_id: execution.execution_id,
      metrics_snapshot: {
        sla_status: execution.sla_status,
        state: execution.state,
        duration_ms: execution.duration_ms
      }
    });

    logger.info(`Created SLA breach alert for execution ${execution.execution_id}`);
  } catch (error) {
    logger.error(`Failed to create SLA breach alert for execution ${execution.execution_id}:`, error);
    // Don't throw - alerting failure should not block execution
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLA STATUS QUERIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get current SLA status summary
 *
 * @returns {Promise<object>} - SLA status summary
 */
export async function getSLAStatus() {
  try {
    const now = new Date();
    const last24h = new Date(now - 24 * 60 * 60 * 1000);

    const result = await Execution.aggregate([
      {
        $match: {
          webhook_received_at: { $gte: last24h },
          sla_policy_id: { $exists: true }
        }
      },
      {
        $facet: {
          overall: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                ack_breached: {
                  $sum: { $cond: ['$sla_status.acknowledge.breached', 1, 0] }
                },
                cont_breached: {
                  $sum: { $cond: ['$sla_status.containment.breached', 1, 0] }
                },
                res_breached: {
                  $sum: { $cond: ['$sla_status.resolution.breached', 1, 0] }
                }
              }
            }
          ],
          by_playbook: [
            {
              $group: {
                _id: '$playbook_id',
                playbook_name: { $first: '$playbook_name' },
                total: { $sum: 1 },
                res_breached: {
                  $sum: { $cond: ['$sla_status.resolution.breached', 1, 0] }
                }
              }
            },
            { $sort: { res_breached: -1 } },
            { $limit: 10 }
          ],
          breach_reasons: [
            {
              $match: { 'sla_status.breach_reason': { $ne: null } }
            },
            {
              $group: {
                _id: '$sla_status.breach_reason',
                count: { $sum: 1 }
              }
            }
          ]
        }
      }
    ]);

    const data = result[0];
    const overall = data.overall[0] || { total: 0, ack_breached: 0, cont_breached: 0, res_breached: 0 };

    return {
      timestamp: now.toISOString(),
      window: '24h',
      overall: {
        total_executions: overall.total,
        acknowledge_breached: overall.ack_breached,
        containment_breached: overall.cont_breached,
        resolution_breached: overall.res_breached,
        compliance_rate: overall.total > 0 ?
          (((overall.total - overall.res_breached) / overall.total) * 100).toFixed(2) : 100
      },
      top_violators: data.by_playbook.map(pb => ({
        playbook_id: pb._id,
        playbook_name: pb.playbook_name,
        total: pb.total,
        breached: pb.res_breached,
        breach_rate: ((pb.res_breached / pb.total) * 100).toFixed(2)
      })),
      breach_reasons: data.breach_reasons.reduce((acc, br) => {
        acc[br._id] = br.count;
        return acc;
      }, {})
    };
  } catch (error) {
    logger.error('Failed to get SLA status:', error);
    throw error;
  }
}

/**
 * Get SLA breaches for a specific time window
 *
 * @param {object} filters - Filters (window, playbook_id, severity)
 * @returns {Promise<Array>} - List of breached executions
 */
export async function getSLABreaches(filters = {}) {
  try {
    const windowMs = {
      '1h': 3600000,
      '4h': 14400000,
      '24h': 86400000,
      '7d': 604800000
    }[filters.window || '24h'];

    const query = {
      webhook_received_at: { $gte: new Date(Date.now() - windowMs) },
      $or: [
        { 'sla_status.acknowledge.breached': true },
        { 'sla_status.containment.breached': true },
        { 'sla_status.resolution.breached': true }
      ]
    };

    if (filters.playbook_id) query.playbook_id = filters.playbook_id;
    if (filters.severity) query['trigger_data.severity'] = filters.severity;

    const breaches = await Execution.find(query)
      .select('execution_id playbook_id playbook_name state sla_status trigger_data.severity webhook_received_at started_at completed_at')
      .sort({ webhook_received_at: -1 })
      .limit(filters.limit || 100)
      .lean();

    return breaches.map(b => ({
      execution_id: b.execution_id,
      playbook_id: b.playbook_id,
      playbook_name: b.playbook_name,
      state: b.state,
      severity: b.trigger_data?.severity,
      sla_status: b.sla_status,
      webhook_received_at: b.webhook_received_at,
      started_at: b.started_at,
      completed_at: b.completed_at
    }));
  } catch (error) {
    logger.error('Failed to get SLA breaches:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

export default {
  applySLAPolicy,
  checkContainmentSLA,
  checkResolutionSLA,
  getSLAStatus,
  getSLABreaches
};
