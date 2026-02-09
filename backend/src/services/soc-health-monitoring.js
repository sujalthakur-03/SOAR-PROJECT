/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.x — SOC HEALTH MONITORING SERVICE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Monitors SOC performance and creates internal health alerts.
 * Runs periodic checks and creates alerts when thresholds are breached.
 *
 * MONITORED CONDITIONS:
 * ─────────────────────────────────────────────────────────────────────────────
 * - Backlog growth: Execution backlog growing faster than resolution rate
 * - SLA breach spike: SLA breach rate exceeding threshold
 * - Playbook failure spike: Playbook failure rate spike
 * - Webhook ingestion drop: Webhook ingestion rate dropped significantly
 * - Approval queue stale: Approvals pending beyond threshold
 *
 * This service is OPTIONAL and runs independently.
 * It can be disabled without affecting core SOAR functionality.
 *
 * VERSION: 1.0.0
 * AUTHOR: SOC Metrics & SLA Architect
 * ══════════════════════════════════════════════════════════════════════════════
 */

import Execution, { ExecutionState } from '../models/execution.js';
import Approval from '../models/approval.js';
import SOCHealthAlert, { SOCHealthAlertType, AlertSeverity } from '../models/soc-health-alert.js';
import logger from '../utils/logger.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION THRESHOLDS
// ═══════════════════════════════════════════════════════════════════════════════

const THRESHOLDS = {
  // Backlog growth detection
  MAX_BACKLOG_SIZE: 100,           // Alert if backlog exceeds this
  BACKLOG_GROWTH_RATE: 10,         // Alert if backlog growing > 10/min

  // SLA breach spike detection
  SLA_BREACH_RATE_CRITICAL: 50,    // Alert if > 50% breaching SLA
  SLA_BREACH_RATE_WARNING: 25,     // Alert if > 25% breaching SLA

  // Playbook failure spike detection
  PLAYBOOK_FAILURE_RATE: 30,       // Alert if > 30% failures for a playbook

  // Webhook ingestion drop detection
  INGESTION_DROP_PERCENT: 50,      // Alert if ingestion drops > 50%

  // Approval queue stale detection
  APPROVAL_STALE_HOURS: 4          // Alert if approvals pending > 4 hours
};

// ═══════════════════════════════════════════════════════════════════════════════
// BACKLOG MONITORING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check for backlog growth
 * Compares current backlog to historical average
 */
export async function checkBacklogGrowth() {
  try {
    const now = new Date();
    const last5m = new Date(now - 5 * 60 * 1000);
    const last1h = new Date(now - 60 * 60 * 1000);

    // Get current backlog
    const currentBacklog = await Execution.countDocuments({
      state: { $in: [ExecutionState.EXECUTING, ExecutionState.WAITING_APPROVAL] }
    });

    // Get executions created in last 5 minutes
    const recentCreated = await Execution.countDocuments({
      webhook_received_at: { $gte: last5m }
    });

    // Get executions completed in last 5 minutes
    const recentCompleted = await Execution.countDocuments({
      completed_at: { $gte: last5m },
      state: { $in: [ExecutionState.COMPLETED, ExecutionState.FAILED] }
    });

    // Calculate growth rate
    const growthRate = recentCreated - recentCompleted;

    // Check if backlog is critical
    if (currentBacklog > THRESHOLDS.MAX_BACKLOG_SIZE) {
      await SOCHealthAlert.createOrIncrement({
        type: SOCHealthAlertType.BACKLOG_GROWING,
        severity: currentBacklog > THRESHOLDS.MAX_BACKLOG_SIZE * 2 ?
          AlertSeverity.CRITICAL : AlertSeverity.HIGH,
        title: 'Execution Backlog Critical',
        message: `Execution backlog has reached ${currentBacklog} items, ` +
                 `exceeding threshold of ${THRESHOLDS.MAX_BACKLOG_SIZE}. ` +
                 `Growth rate: ${growthRate} executions/5min.`,
        context: {
          current_backlog: currentBacklog,
          threshold: THRESHOLDS.MAX_BACKLOG_SIZE,
          growth_rate: growthRate,
          recent_created: recentCreated,
          recent_completed: recentCompleted
        },
        resource_type: 'system',
        metrics_snapshot: {
          backlog_size: currentBacklog,
          growth_rate: growthRate,
          timestamp: now
        }
      });

      logger.warn(`Backlog critical: ${currentBacklog} items (growth: ${growthRate}/5min)`);
    } else if (currentBacklog > 0) {
      // Auto-resolve if backlog is healthy
      await SOCHealthAlert.autoResolveByType(SOCHealthAlertType.BACKLOG_GROWING);
    }

    return {
      current_backlog: currentBacklog,
      growth_rate: growthRate,
      healthy: currentBacklog <= THRESHOLDS.MAX_BACKLOG_SIZE
    };
  } catch (error) {
    logger.error('Failed to check backlog growth:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLA BREACH MONITORING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check for SLA breach spike
 * Monitors SLA breach rate over time window
 */
export async function checkSLABreachSpike() {
  try {
    const now = new Date();
    const last1h = new Date(now - 60 * 60 * 1000);

    // Get executions in last hour with SLA tracking
    const result = await Execution.aggregate([
      {
        $match: {
          webhook_received_at: { $gte: last1h },
          sla_policy_id: { $exists: true }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          breached: {
            $sum: {
              $cond: [
                { $or: [
                  '$sla_status.acknowledge.breached',
                  '$sla_status.containment.breached',
                  '$sla_status.resolution.breached'
                ]},
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    if (!result || result.length === 0) {
      return { healthy: true, breach_rate: 0 };
    }

    const stats = result[0];
    const breachRate = (stats.breached / stats.total) * 100;

    // Check breach rate thresholds
    if (breachRate > THRESHOLDS.SLA_BREACH_RATE_CRITICAL) {
      await SOCHealthAlert.createOrIncrement({
        type: SOCHealthAlertType.SLA_BREACH_SPIKE,
        severity: AlertSeverity.CRITICAL,
        title: 'Critical SLA Breach Rate',
        message: `SLA breach rate is ${breachRate.toFixed(1)}% in the last hour, ` +
                 `exceeding critical threshold of ${THRESHOLDS.SLA_BREACH_RATE_CRITICAL}%. ` +
                 `${stats.breached} out of ${stats.total} executions breached SLA.`,
        context: {
          breach_rate: breachRate,
          breached_count: stats.breached,
          total_count: stats.total,
          threshold: THRESHOLDS.SLA_BREACH_RATE_CRITICAL,
          window: '1h'
        },
        resource_type: 'system',
        metrics_snapshot: {
          breach_rate: breachRate,
          timestamp: now
        }
      });

      logger.warn(`SLA breach spike: ${breachRate.toFixed(1)}% breach rate`);
    } else if (breachRate > THRESHOLDS.SLA_BREACH_RATE_WARNING) {
      await SOCHealthAlert.createOrIncrement({
        type: SOCHealthAlertType.SLA_BREACH_SPIKE,
        severity: AlertSeverity.HIGH,
        title: 'Elevated SLA Breach Rate',
        message: `SLA breach rate is ${breachRate.toFixed(1)}% in the last hour, ` +
                 `exceeding warning threshold of ${THRESHOLDS.SLA_BREACH_RATE_WARNING}%.`,
        context: {
          breach_rate: breachRate,
          breached_count: stats.breached,
          total_count: stats.total,
          threshold: THRESHOLDS.SLA_BREACH_RATE_WARNING,
          window: '1h'
        },
        resource_type: 'system',
        metrics_snapshot: {
          breach_rate: breachRate,
          timestamp: now
        }
      });
    } else {
      // Auto-resolve if breach rate is healthy
      await SOCHealthAlert.autoResolveByType(SOCHealthAlertType.SLA_BREACH_SPIKE);
    }

    return {
      breach_rate: breachRate,
      breached_count: stats.breached,
      total_count: stats.total,
      healthy: breachRate <= THRESHOLDS.SLA_BREACH_RATE_WARNING
    };
  } catch (error) {
    logger.error('Failed to check SLA breach spike:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAYBOOK FAILURE MONITORING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check for playbook failure spikes
 * Monitors per-playbook failure rates
 */
export async function checkPlaybookFailureSpike() {
  try {
    const now = new Date();
    const last1h = new Date(now - 60 * 60 * 1000);

    // Get per-playbook failure rates
    const result = await Execution.aggregate([
      {
        $match: {
          started_at: { $gte: last1h },
          state: { $in: [ExecutionState.COMPLETED, ExecutionState.FAILED] }
        }
      },
      {
        $group: {
          _id: '$playbook_id',
          playbook_name: { $first: '$playbook_name' },
          total: { $sum: 1 },
          failed: {
            $sum: { $cond: [{ $eq: ['$state', ExecutionState.FAILED] }, 1, 0] }
          }
        }
      },
      {
        $match: {
          total: { $gte: 5 } // Only check playbooks with at least 5 executions
        }
      }
    ]);

    const failures = [];

    for (const playbook of result) {
      const failureRate = (playbook.failed / playbook.total) * 100;

      if (failureRate > THRESHOLDS.PLAYBOOK_FAILURE_RATE) {
        await SOCHealthAlert.createOrIncrement({
          type: SOCHealthAlertType.PLAYBOOK_FAILURE_SPIKE,
          severity: failureRate > 50 ? AlertSeverity.CRITICAL : AlertSeverity.HIGH,
          title: `Playbook Failure Spike: ${playbook.playbook_name}`,
          message: `Playbook ${playbook.playbook_name} (${playbook._id}) has a failure rate of ` +
                   `${failureRate.toFixed(1)}% in the last hour (${playbook.failed}/${playbook.total} failed).`,
          context: {
            playbook_id: playbook._id,
            playbook_name: playbook.playbook_name,
            failure_rate: failureRate,
            failed_count: playbook.failed,
            total_count: playbook.total,
            threshold: THRESHOLDS.PLAYBOOK_FAILURE_RATE,
            window: '1h'
          },
          resource_type: 'playbook',
          resource_id: playbook._id,
          metrics_snapshot: {
            failure_rate: failureRate,
            timestamp: now
          }
        });

        failures.push({
          playbook_id: playbook._id,
          playbook_name: playbook.playbook_name,
          failure_rate: failureRate
        });

        logger.warn(`Playbook failure spike: ${playbook.playbook_name} at ${failureRate.toFixed(1)}%`);
      } else {
        // Auto-resolve if failure rate is healthy
        await SOCHealthAlert.autoResolveByType(
          SOCHealthAlertType.PLAYBOOK_FAILURE_SPIKE,
          playbook._id
        );
      }
    }

    return {
      failures,
      healthy: failures.length === 0
    };
  } catch (error) {
    logger.error('Failed to check playbook failure spike:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK INGESTION MONITORING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check for webhook ingestion drop
 * Compares current ingestion rate to historical average
 */
export async function checkWebhookIngestionDrop() {
  try {
    const now = new Date();
    const last15m = new Date(now - 15 * 60 * 1000);
    const last1h = new Date(now - 60 * 60 * 1000);

    // Get current ingestion rate (last 15 minutes)
    const recentCount = await Execution.countDocuments({
      webhook_received_at: { $gte: last15m }
    });

    // Get historical average (last hour, excluding last 15 minutes)
    const historicalCount = await Execution.countDocuments({
      webhook_received_at: { $gte: last1h, $lt: last15m }
    });

    // Normalize to 15-minute windows
    const recentRate = recentCount;
    const historicalRate = historicalCount / 3; // Average per 15-min window

    if (historicalRate === 0) {
      // No historical data - can't detect drop
      return { healthy: true, drop_percent: 0 };
    }

    const dropPercent = ((historicalRate - recentRate) / historicalRate) * 100;

    if (dropPercent > THRESHOLDS.INGESTION_DROP_PERCENT && historicalRate >= 5) {
      await SOCHealthAlert.createOrIncrement({
        type: SOCHealthAlertType.WEBHOOK_INGESTION_DROP,
        severity: dropPercent > 80 ? AlertSeverity.CRITICAL : AlertSeverity.HIGH,
        title: 'Webhook Ingestion Drop Detected',
        message: `Webhook ingestion rate dropped by ${dropPercent.toFixed(1)}% in the last 15 minutes. ` +
                 `Current: ${recentCount} alerts, Expected: ~${Math.round(historicalRate)} alerts.`,
        context: {
          drop_percent: dropPercent,
          recent_count: recentCount,
          expected_count: Math.round(historicalRate),
          threshold: THRESHOLDS.INGESTION_DROP_PERCENT,
          window: '15m'
        },
        resource_type: 'system',
        metrics_snapshot: {
          drop_percent: dropPercent,
          recent_count: recentCount,
          timestamp: now
        }
      });

      logger.warn(`Webhook ingestion drop: ${dropPercent.toFixed(1)}% decrease`);
    } else if (dropPercent < 0) {
      // Ingestion rate increased - resolve any existing alerts
      await SOCHealthAlert.autoResolveByType(SOCHealthAlertType.WEBHOOK_INGESTION_DROP);
    }

    return {
      drop_percent: dropPercent,
      recent_count: recentCount,
      expected_count: Math.round(historicalRate),
      healthy: dropPercent <= THRESHOLDS.INGESTION_DROP_PERCENT
    };
  } catch (error) {
    logger.error('Failed to check webhook ingestion drop:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// APPROVAL QUEUE MONITORING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check for stale approval queue
 * Monitors approvals pending beyond threshold
 */
export async function checkApprovalQueueStale() {
  try {
    const now = new Date();
    const staleThreshold = new Date(now - THRESHOLDS.APPROVAL_STALE_HOURS * 60 * 60 * 1000);

    // Get stale approvals
    const staleApprovals = await Approval.find({
      status: 'pending',
      created_at: { $lt: staleThreshold }
    }).select('_id playbook_id created_at').lean();

    if (staleApprovals.length > 0) {
      await SOCHealthAlert.createOrIncrement({
        type: SOCHealthAlertType.APPROVAL_QUEUE_STALE,
        severity: staleApprovals.length > 10 ? AlertSeverity.CRITICAL : AlertSeverity.HIGH,
        title: 'Stale Approval Queue',
        message: `${staleApprovals.length} approvals have been pending for more than ` +
                 `${THRESHOLDS.APPROVAL_STALE_HOURS} hours and require attention.`,
        context: {
          stale_count: staleApprovals.length,
          threshold_hours: THRESHOLDS.APPROVAL_STALE_HOURS,
          oldest_approval_age_hours: (now - new Date(staleApprovals[0].created_at)) / (1000 * 60 * 60)
        },
        resource_type: 'system',
        metrics_snapshot: {
          stale_count: staleApprovals.length,
          timestamp: now
        }
      });

      logger.warn(`Stale approval queue: ${staleApprovals.length} approvals pending > ${THRESHOLDS.APPROVAL_STALE_HOURS}h`);
    } else {
      // Auto-resolve if queue is healthy
      await SOCHealthAlert.autoResolveByType(SOCHealthAlertType.APPROVAL_QUEUE_STALE);
    }

    return {
      stale_count: staleApprovals.length,
      healthy: staleApprovals.length === 0
    };
  } catch (error) {
    logger.error('Failed to check approval queue:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPREHENSIVE HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run all health checks
 * Returns comprehensive health status
 */
export async function runHealthChecks() {
  try {
    logger.info('Running SOC health checks...');

    const [
      backlog,
      slaBreaches,
      playbookFailures,
      webhookIngestion,
      approvalQueue
    ] = await Promise.all([
      checkBacklogGrowth(),
      checkSLABreachSpike(),
      checkPlaybookFailureSpike(),
      checkWebhookIngestionDrop(),
      checkApprovalQueueStale()
    ]);

    const healthy = backlog.healthy &&
                    slaBreaches.healthy &&
                    playbookFailures.healthy &&
                    webhookIngestion.healthy &&
                    approvalQueue.healthy;

    logger.info(`SOC health checks complete. Overall health: ${healthy ? 'HEALTHY' : 'DEGRADED'}`);

    return {
      timestamp: new Date().toISOString(),
      overall_health: healthy ? 'healthy' : 'degraded',
      checks: {
        backlog,
        sla_breaches: slaBreaches,
        playbook_failures: playbookFailures,
        webhook_ingestion: webhookIngestion,
        approval_queue: approvalQueue
      }
    };
  } catch (error) {
    logger.error('Failed to run health checks:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

export default {
  checkBacklogGrowth,
  checkSLABreachSpike,
  checkPlaybookFailureSpike,
  checkWebhookIngestionDrop,
  checkApprovalQueueStale,
  runHealthChecks,
  THRESHOLDS
};
