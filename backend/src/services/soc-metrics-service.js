/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.x — SOC METRICS SERVICE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Calculates SOC Key Performance Indicators (KPIs) from execution data.
 * All metrics are derived STRICTLY from MongoDB execution collection.
 *
 * CORE KPIs:
 * ─────────────────────────────────────────────────────────────────────────────
 * - MTTA (Mean Time To Acknowledge): Webhook received → execution created
 * - MTTR (Mean Time To Respond): Execution created → terminal state
 * - MTTC (Mean Time To Contain): Execution created → containment action
 * - Playbook Success Rate: Success / total executions per playbook
 * - Automation Coverage: % alerts fully resolved without human steps
 * - Execution Failure Rate: Per playbook + global
 * - Backlog Size: Executions in RUNNING/WAITING beyond SLA
 * - Alert Throughput: Executions per minute (rolling window)
 *
 * All queries are INDEX-OPTIMIZED. No full collection scans.
 *
 * VERSION: 1.0.0
 * AUTHOR: SOC Metrics & SLA Architect
 * ══════════════════════════════════════════════════════════════════════════════
 */

import mongoose from 'mongoose';
import Execution, { ExecutionState } from '../models/execution.js';
import Approval from '../models/approval.js';
import SLAPolicy from '../models/sla-policy.js';
import logger from '../utils/logger.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TIME WINDOW UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse time window string to milliseconds
 */
function parseTimeWindow(window) {
  const windowMap = {
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000
  };

  return windowMap[window] || windowMap['24h'];
}

/**
 * Get time range object for queries
 */
function getTimeRange(window = '24h') {
  const ms = parseTimeWindow(window);
  const now = new Date();
  return {
    start: new Date(now - ms),
    end: now,
    ms
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MTTA: MEAN TIME TO ACKNOWLEDGE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate MTTA across all executions or filtered subset
 *
 * MTTA = Average time from webhook_received_at to acknowledged_at
 *
 * @param {object} filters - Optional filters (playbook_id, severity, window)
 * @returns {Promise<object>} - MTTA metrics
 */
export async function calculateMTTA(filters = {}) {
  try {
    const timeRange = getTimeRange(filters.window || '24h');

    const matchStage = {
      webhook_received_at: { $gte: timeRange.start },
      acknowledged_at: { $exists: true }
    };

    if (filters.playbook_id) matchStage.playbook_id = filters.playbook_id;
    if (filters.severity) matchStage['trigger_data.severity'] = filters.severity;

    const result = await Execution.aggregate([
      { $match: matchStage },
      {
        $project: {
          mtta_ms: {
            $subtract: ['$acknowledged_at', '$webhook_received_at']
          }
        }
      },
      {
        $group: {
          _id: null,
          avg_mtta_ms: { $avg: '$mtta_ms' },
          min_mtta_ms: { $min: '$mtta_ms' },
          max_mtta_ms: { $max: '$mtta_ms' },
          p50_mtta_ms: { $median: { input: '$mtta_ms', method: 'approximate' } },
          p95_mtta_ms: { $percentile: { input: ['$mtta_ms'], p: [0.95], method: 'approximate' } },
          sample_count: { $sum: 1 }
        }
      }
    ]);

    if (!result || result.length === 0) {
      return {
        avg_mtta_ms: null,
        min_mtta_ms: null,
        max_mtta_ms: null,
        p50_mtta_ms: null,
        p95_mtta_ms: null,
        sample_count: 0,
        window: filters.window || '24h'
      };
    }

    const stats = result[0];

    return {
      avg_mtta_ms: Math.round(stats.avg_mtta_ms || 0),
      min_mtta_ms: Math.round(stats.min_mtta_ms || 0),
      max_mtta_ms: Math.round(stats.max_mtta_ms || 0),
      p50_mtta_ms: Math.round(stats.p50_mtta_ms || 0),
      p95_mtta_ms: Math.round(stats.p95_mtta_ms?.[0] || 0),
      sample_count: stats.sample_count,
      window: filters.window || '24h'
    };
  } catch (error) {
    logger.error('Failed to calculate MTTA:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MTTR: MEAN TIME TO RESPOND/RESOLVE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate MTTR across all executions or filtered subset
 *
 * MTTR = Average time from started_at to completed_at (terminal state)
 *
 * @param {object} filters - Optional filters (playbook_id, severity, window)
 * @returns {Promise<object>} - MTTR metrics
 */
export async function calculateMTTR(filters = {}) {
  try {
    const timeRange = getTimeRange(filters.window || '24h');

    const matchStage = {
      started_at: { $gte: timeRange.start },
      state: { $in: [ExecutionState.COMPLETED, ExecutionState.FAILED] },
      duration_ms: { $exists: true }
    };

    if (filters.playbook_id) matchStage.playbook_id = filters.playbook_id;
    if (filters.severity) matchStage['trigger_data.severity'] = filters.severity;

    const result = await Execution.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          avg_mttr_ms: { $avg: '$duration_ms' },
          min_mttr_ms: { $min: '$duration_ms' },
          max_mttr_ms: { $max: '$duration_ms' },
          p50_mttr_ms: { $median: { input: '$duration_ms', method: 'approximate' } },
          p95_mttr_ms: { $percentile: { input: ['$duration_ms'], p: [0.95], method: 'approximate' } },
          sample_count: { $sum: 1 }
        }
      }
    ]);

    if (!result || result.length === 0) {
      return {
        avg_mttr_ms: null,
        min_mttr_ms: null,
        max_mttr_ms: null,
        p50_mttr_ms: null,
        p95_mttr_ms: null,
        sample_count: 0,
        window: filters.window || '24h'
      };
    }

    const stats = result[0];

    return {
      avg_mttr_ms: Math.round(stats.avg_mttr_ms || 0),
      min_mttr_ms: Math.round(stats.min_mttr_ms || 0),
      max_mttr_ms: Math.round(stats.max_mttr_ms || 0),
      p50_mttr_ms: Math.round(stats.p50_mttr_ms || 0),
      p95_mttr_ms: Math.round(stats.p95_mttr_ms?.[0] || 0),
      sample_count: stats.sample_count,
      window: filters.window || '24h'
    };
  } catch (error) {
    logger.error('Failed to calculate MTTR:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUCCESS RATE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate execution success rate
 *
 * Success Rate = (COMPLETED / (COMPLETED + FAILED)) * 100
 *
 * @param {object} filters - Optional filters (playbook_id, severity, window)
 * @returns {Promise<object>} - Success rate metrics
 */
export async function calculateSuccessRate(filters = {}) {
  try {
    const timeRange = getTimeRange(filters.window || '24h');

    const matchStage = {
      started_at: { $gte: timeRange.start },
      state: { $in: [ExecutionState.COMPLETED, ExecutionState.FAILED] }
    };

    if (filters.playbook_id) matchStage.playbook_id = filters.playbook_id;
    if (filters.severity) matchStage['trigger_data.severity'] = filters.severity;

    const result = await Execution.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$state',
          count: { $sum: 1 }
        }
      }
    ]);

    const completed = result.find(r => r._id === ExecutionState.COMPLETED)?.count || 0;
    const failed = result.find(r => r._id === ExecutionState.FAILED)?.count || 0;
    const total = completed + failed;

    return {
      success_rate: total > 0 ? ((completed / total) * 100).toFixed(2) : 0,
      completed_count: completed,
      failed_count: failed,
      total_count: total,
      window: filters.window || '24h'
    };
  } catch (error) {
    logger.error('Failed to calculate success rate:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTOMATION COVERAGE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate automation coverage
 *
 * Automation Coverage = % of executions completed without manual approval
 *
 * @param {object} filters - Optional filters (playbook_id, window)
 * @returns {Promise<object>} - Automation coverage metrics
 */
export async function calculateAutomationCoverage(filters = {}) {
  try {
    const timeRange = getTimeRange(filters.window || '24h');

    const matchStage = {
      started_at: { $gte: timeRange.start },
      state: ExecutionState.COMPLETED
    };

    if (filters.playbook_id) matchStage.playbook_id = filters.playbook_id;

    const [totalCompleted, withApproval] = await Promise.all([
      Execution.countDocuments(matchStage),
      Execution.countDocuments({
        ...matchStage,
        approval_id: { $exists: true }
      })
    ]);

    const fullyAutomated = totalCompleted - withApproval;

    return {
      automation_coverage: totalCompleted > 0 ? ((fullyAutomated / totalCompleted) * 100).toFixed(2) : 0,
      fully_automated_count: fullyAutomated,
      manual_intervention_count: withApproval,
      total_completed: totalCompleted,
      window: filters.window || '24h'
    };
  } catch (error) {
    logger.error('Failed to calculate automation coverage:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BACKLOG SIZE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get current execution backlog
 *
 * Backlog = Executions in EXECUTING or WAITING_APPROVAL state
 *
 * @returns {Promise<object>} - Backlog metrics
 */
export async function getBacklog() {
  try {
    const result = await Execution.aggregate([
      {
        $match: {
          state: { $in: [ExecutionState.EXECUTING, ExecutionState.WAITING_APPROVAL] }
        }
      },
      {
        $facet: {
          total: [{ $count: 'count' }],
          by_state: [
            { $group: { _id: '$state', count: { $sum: 1 } } }
          ],
          by_severity: [
            { $group: { _id: '$trigger_data.severity', count: { $sum: 1 } } }
          ],
          sla_breached: [
            {
              $match: {
                $or: [
                  { 'sla_status.resolution.breached': true },
                  { 'sla_status.containment.breached': true }
                ]
              }
            },
            { $count: 'count' }
          ]
        }
      }
    ]);

    const data = result[0];
    const total = data.total[0]?.count || 0;
    const executing = data.by_state.find(s => s._id === ExecutionState.EXECUTING)?.count || 0;
    const waiting = data.by_state.find(s => s._id === ExecutionState.WAITING_APPROVAL)?.count || 0;
    const slaBreached = data.sla_breached[0]?.count || 0;

    const bySeverity = {};
    data.by_severity.forEach(s => {
      if (s._id) {
        bySeverity[s._id.toLowerCase()] = s.count;
      }
    });

    return {
      total_backlog: total,
      executing_count: executing,
      waiting_approval_count: waiting,
      sla_breached_count: slaBreached,
      by_severity: bySeverity
    };
  } catch (error) {
    logger.error('Failed to get backlog:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ALERT THROUGHPUT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate alert throughput (executions per minute)
 *
 * @param {object} filters - Optional filters (window)
 * @returns {Promise<object>} - Throughput metrics
 */
export async function calculateThroughput(filters = {}) {
  try {
    const timeRange = getTimeRange(filters.window || '1h');

    const count = await Execution.countDocuments({
      webhook_received_at: { $gte: timeRange.start }
    });

    const windowMinutes = timeRange.ms / (60 * 1000);
    const perMinute = count / windowMinutes;

    return {
      total_executions: count,
      window_minutes: Math.round(windowMinutes),
      executions_per_minute: perMinute.toFixed(2),
      window: filters.window || '1h'
    };
  } catch (error) {
    logger.error('Failed to calculate throughput:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLA COMPLIANCE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate SLA compliance metrics
 *
 * @param {object} filters - Optional filters (playbook_id, window)
 * @returns {Promise<object>} - SLA compliance metrics
 */
export async function calculateSLACompliance(filters = {}) {
  try {
    const timeRange = getTimeRange(filters.window || '24h');

    const matchStage = {
      webhook_received_at: { $gte: timeRange.start },
      sla_policy_id: { $exists: true }
    };

    if (filters.playbook_id) matchStage.playbook_id = filters.playbook_id;

    const result = await Execution.aggregate([
      { $match: matchStage },
      {
        $facet: {
          acknowledge_sla: [
            {
              $group: {
                _id: '$sla_status.acknowledge.breached',
                count: { $sum: 1 }
              }
            }
          ],
          containment_sla: [
            {
              $match: { containment_at: { $exists: true } }
            },
            {
              $group: {
                _id: '$sla_status.containment.breached',
                count: { $sum: 1 }
              }
            }
          ],
          resolution_sla: [
            {
              $match: { state: { $in: [ExecutionState.COMPLETED, ExecutionState.FAILED] } }
            },
            {
              $group: {
                _id: '$sla_status.resolution.breached',
                count: { $sum: 1 }
              }
            }
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

    // Acknowledge SLA
    const ackCompliant = data.acknowledge_sla.find(a => a._id === false)?.count || 0;
    const ackBreached = data.acknowledge_sla.find(a => a._id === true)?.count || 0;
    const ackTotal = ackCompliant + ackBreached;

    // Containment SLA
    const contCompliant = data.containment_sla.find(c => c._id === false)?.count || 0;
    const contBreached = data.containment_sla.find(c => c._id === true)?.count || 0;
    const contTotal = contCompliant + contBreached;

    // Resolution SLA
    const resCompliant = data.resolution_sla.find(r => r._id === false)?.count || 0;
    const resBreached = data.resolution_sla.find(r => r._id === true)?.count || 0;
    const resTotal = resCompliant + resBreached;

    // Breach reasons
    const breachReasons = {};
    data.breach_reasons.forEach(br => {
      breachReasons[br._id] = br.count;
    });

    return {
      acknowledge_sla: {
        compliant: ackCompliant,
        breached: ackBreached,
        total: ackTotal,
        compliance_rate: ackTotal > 0 ? ((ackCompliant / ackTotal) * 100).toFixed(2) : 100
      },
      containment_sla: {
        compliant: contCompliant,
        breached: contBreached,
        total: contTotal,
        compliance_rate: contTotal > 0 ? ((contCompliant / contTotal) * 100).toFixed(2) : 100
      },
      resolution_sla: {
        compliant: resCompliant,
        breached: resBreached,
        total: resTotal,
        compliance_rate: resTotal > 0 ? ((resCompliant / resTotal) * 100).toFixed(2) : 100
      },
      breach_reasons: breachReasons,
      window: filters.window || '24h'
    };
  } catch (error) {
    logger.error('Failed to calculate SLA compliance:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PER-PLAYBOOK PERFORMANCE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get performance metrics for a specific playbook
 *
 * @param {string} playbookId - Playbook ID
 * @param {string} window - Time window (default: 24h)
 * @returns {Promise<object>} - Playbook performance metrics
 */
export async function getPlaybookPerformance(playbookId, window = '24h') {
  try {
    const [mtta, mttr, successRate, automationCoverage, slaCompliance] = await Promise.all([
      calculateMTTA({ playbook_id: playbookId, window }),
      calculateMTTR({ playbook_id: playbookId, window }),
      calculateSuccessRate({ playbook_id: playbookId, window }),
      calculateAutomationCoverage({ playbook_id: playbookId, window }),
      calculateSLACompliance({ playbook_id: playbookId, window })
    ]);

    return {
      playbook_id: playbookId,
      window,
      mtta,
      mttr,
      success_rate: successRate,
      automation_coverage: automationCoverage,
      sla_compliance: slaCompliance
    };
  } catch (error) {
    logger.error(`Failed to get playbook performance for ${playbookId}:`, error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPREHENSIVE SOC KPI DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get comprehensive SOC KPIs for dashboard
 *
 * @param {string} window - Time window (default: 24h)
 * @returns {Promise<object>} - All KPIs
 */
export async function getSOCKPIs(window = '24h') {
  try {
    const [mtta, mttr, successRate, automationCoverage, backlog, throughput, slaCompliance] = await Promise.all([
      calculateMTTA({ window }),
      calculateMTTR({ window }),
      calculateSuccessRate({ window }),
      calculateAutomationCoverage({ window }),
      getBacklog(),
      calculateThroughput({ window }),
      calculateSLACompliance({ window })
    ]);

    return {
      window,
      timestamp: new Date().toISOString(),
      mtta,
      mttr,
      success_rate: successRate,
      automation_coverage: automationCoverage,
      backlog,
      throughput,
      sla_compliance: slaCompliance
    };
  } catch (error) {
    logger.error('Failed to get SOC KPIs:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// APPROVAL LATENCY METRICS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate approval latency metrics
 *
 * @param {string} window - Time window
 * @returns {Promise<object>} - Approval latency metrics
 */
export async function calculateApprovalLatency(window = '24h') {
  try {
    const timeRange = getTimeRange(window);

    const result = await Approval.aggregate([
      {
        $match: {
          created_at: { $gte: timeRange.start },
          status: { $in: ['approved', 'rejected'] },
          approved_at: { $exists: true }
        }
      },
      {
        $project: {
          latency_ms: {
            $subtract: ['$approved_at', '$created_at']
          },
          status: 1
        }
      },
      {
        $group: {
          _id: null,
          avg_latency_ms: { $avg: '$latency_ms' },
          min_latency_ms: { $min: '$latency_ms' },
          max_latency_ms: { $max: '$latency_ms' },
          p50_latency_ms: { $median: { input: '$latency_ms', method: 'approximate' } },
          total_count: { $sum: 1 },
          approved_count: {
            $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] }
          },
          rejected_count: {
            $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] }
          }
        }
      }
    ]);

    if (!result || result.length === 0) {
      return {
        avg_latency_ms: null,
        min_latency_ms: null,
        max_latency_ms: null,
        p50_latency_ms: null,
        total_count: 0,
        approved_count: 0,
        rejected_count: 0,
        approval_rate: 0,
        window
      };
    }

    const stats = result[0];
    const approvalRate = stats.total_count > 0 ?
      ((stats.approved_count / stats.total_count) * 100).toFixed(2) : 0;

    return {
      avg_latency_ms: Math.round(stats.avg_latency_ms || 0),
      min_latency_ms: Math.round(stats.min_latency_ms || 0),
      max_latency_ms: Math.round(stats.max_latency_ms || 0),
      p50_latency_ms: Math.round(stats.p50_latency_ms || 0),
      total_count: stats.total_count,
      approved_count: stats.approved_count,
      rejected_count: stats.rejected_count,
      approval_rate: approvalRate,
      window
    };
  } catch (error) {
    logger.error('Failed to calculate approval latency:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

export default {
  calculateMTTA,
  calculateMTTR,
  calculateSuccessRate,
  calculateAutomationCoverage,
  getBacklog,
  calculateThroughput,
  calculateSLACompliance,
  getPlaybookPerformance,
  getSOCKPIs,
  calculateApprovalLatency
};
