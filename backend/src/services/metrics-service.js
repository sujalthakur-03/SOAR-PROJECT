/**
 * CyberSentinel Metrics Service
 * Lightweight, non-blocking observability layer
 *
 * - In-memory counters for high-frequency increment operations
 * - Real MongoDB queries for dashboard KPIs
 * - No raw event storage, no alert persistence
 */

import Execution, { ExecutionState } from '../models/execution.js';
import Approval from '../models/approval.js';
import mongoose from 'mongoose';

// ═══════════════════════════════════════════════════════════════════════════════
// IN-MEMORY COUNTER MAP
// ═══════════════════════════════════════════════════════════════════════════════

const counters = new Map();

/**
 * Increment a metric counter.
 * Uses an in-memory counter map (suitable for single-instance deployment).
 *
 * Signature is backward-compatible:
 *   incrementMetric('name')
 *   incrementMetric('name', 1)
 *   incrementMetric('name', { connector: 'xyz' })   // labels as 2nd arg (legacy callers)
 *   incrementMetric('name', 1, { connector: 'xyz' })
 *
 * @param {string} name   - Counter name (e.g. 'executions_total')
 * @param {number|object} [value=1] - Increment amount, or labels object (for backward compat)
 * @param {object} [labels={}] - Optional labels (currently unused, reserved for future exporters)
 */
export function incrementMetric(name, value = 1, labels = {}) {
  // Handle legacy callers that pass labels object as second arg
  let inc = value;
  if (typeof value === 'object' && value !== null) {
    inc = 1;
    // labels = value;  // reserved for future use
  }

  const current = counters.get(name) || 0;
  counters.set(name, current + inc);
}

/**
 * Get a specific counter value.
 *
 * @param {string} name - Counter name
 * @returns {number} Current counter value (0 if not set)
 */
export function getCounter(name) {
  return counters.get(name) || 0;
}

/**
 * Reset all in-memory counters (for testing).
 */
export function resetMetrics() {
  counters.clear();
}

// ═══════════════════════════════════════════════════════════════════════════════
// REAL METRICS FROM MONGODB
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Aggregate metrics for SOC UI dashboard.
 *
 * Calculates real KPIs from MongoDB collections + in-memory counters.
 *
 * @returns {Promise<object>} Dashboard metrics
 */
export async function getMetrics() {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);

  // Run all queries in parallel for speed
  const [
    mttrResult,
    failedCount,
    pendingApprovalCount,
    alertsProcessed24h,
    automationCounts,
    connectorHealth,
  ] = await Promise.all([
    // MTTR: avg seconds from created_at to completed_at for COMPLETED in last 24h
    Execution.aggregate([
      {
        $match: {
          state: ExecutionState.COMPLETED,
          created_at: { $gte: twentyFourHoursAgo },
          completed_at: { $exists: true },
        },
      },
      {
        $project: {
          resolution_ms: { $subtract: ['$completed_at', '$created_at'] },
        },
      },
      {
        $group: {
          _id: null,
          avg_ms: { $avg: '$resolution_ms' },
        },
      },
    ]),

    // Failed executions in last 24h
    Execution.countDocuments({
      state: ExecutionState.FAILED,
      created_at: { $gte: twentyFourHoursAgo },
    }),

    // Pending approvals
    Approval.countDocuments({ status: 'pending' }),

    // Total executions created in last 24h
    Execution.countDocuments({
      created_at: { $gte: twentyFourHoursAgo },
    }),

    // Automation vs manual: completed executions with/without approval
    Promise.all([
      Execution.countDocuments({
        state: ExecutionState.COMPLETED,
        created_at: { $gte: twentyFourHoursAgo },
        approval_id: { $exists: false },
      }),
      Execution.countDocuments({
        state: ExecutionState.COMPLETED,
        created_at: { $gte: twentyFourHoursAgo },
        approval_id: { $exists: true },
      }),
    ]),

    // Connector health from connectors collection
    getConnectorHealth(),
  ]);

  // MTTR in seconds
  const mttrSeconds =
    mttrResult.length > 0 && mttrResult[0].avg_ms != null
      ? Math.round(mttrResult[0].avg_ms / 1000)
      : 0;

  // Automated vs manual counts
  const [automatedFromDb, manualFromDb] = automationCounts;

  // Prefer DB counts; fall back to in-memory counters if DB returns 0
  const automated = automatedFromDb || getCounter('actions_automated');
  const manual = manualFromDb || getCounter('actions_manual');
  const total = automated + manual;
  const automationRate = total > 0 ? Math.round((automated / total) * 100) : 0;

  return {
    mttr_seconds: mttrSeconds,
    automated_actions: automated,
    manual_actions: manual,
    automation_rate: automationRate,
    failed_executions: failedCount,
    pending_approvals: pendingApprovalCount,
    alerts_processed_24h: alertsProcessed24h,
    connector_health: connectorHealth,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTOR HEALTH HELPER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Query connector health from the connectors collection.
 * Falls back to zeroes if the collection doesn't exist or is empty.
 *
 * @returns {Promise<{healthy: number, degraded: number, error: number}>}
 */
async function getConnectorHealth() {
  try {
    // Only query if the Connector model is registered
    if (!mongoose.modelNames().includes('Connector')) {
      return { healthy: 0, degraded: 0, error: 0 };
    }

    const Connector = mongoose.model('Connector');
    const result = await Connector.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    const byStatus = {};
    result.forEach((r) => {
      byStatus[r._id] = r.count;
    });

    return {
      healthy: (byStatus['active'] || 0),
      degraded: (byStatus['testing'] || 0) + (byStatus['inactive'] || 0),
      error: (byStatus['error'] || 0),
    };
  } catch {
    return { healthy: 0, degraded: 0, error: 0 };
  }
}
