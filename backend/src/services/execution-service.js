/**
 * Execution Service
 * Business logic for execution operations with MongoDB
 *
 * EXECUTION ID FORMAT: EXE-YYYYMMDD-RANDOM (e.g., "EXE-20260116-A1B2C3")
 * - This is the PRIMARY identifier for external use
 * - MongoDB _id is internal only
 *
 * STATE VALUES (CANONICAL):
 *   - EXECUTING: Currently running
 *   - WAITING_APPROVAL: Paused waiting for approval
 *   - COMPLETED: Successfully finished
 *   - FAILED: Execution failed
 */

import mongoose from 'mongoose';
import { Execution, Playbook } from '../models/index.js';
import { ExecutionState, StepState } from '../models/execution.js';
import logger from '../utils/logger.js';

/**
 * Helper to find execution by execution_id or MongoDB _id
 * Prefers execution_id (human-readable) over MongoDB _id
 */
async function findExecutionByIdOrLogicalId(id) {
  // First try as execution_id (human-readable like "EXE-20260116-A1B2C3")
  let execution = await Execution.findOne({ execution_id: id });

  // If not found and it looks like a MongoDB ObjectId, try that
  if (!execution && mongoose.Types.ObjectId.isValid(id)) {
    execution = await Execution.findById(id);
  }

  return execution;
}

/**
 * Get all executions with optional filters
 *
 * Supported filters:
 *   - playbook_id: Filter by playbook
 *   - state: EXECUTING | WAITING_APPROVAL | COMPLETED | FAILED
 *   - severity: Filter by trigger_data.severity (exact match or array)
 *   - rule_id: Filter by trigger_data.rule_id
 *   - trigger_id: Filter by trigger_snapshot.trigger_id
 *   - from_time: Filter event_time >= (ISO 8601)
 *   - to_time: Filter event_time <= (ISO 8601)
 *   - start_date / end_date: Date range on created_at (DEPRECATED - use from_time/to_time)
 *   - limit: Pagination limit (default 100, max 500)
 *   - offset: Pagination offset
 *   - sort_by: execution_id | event_time | created_at | started_at (default: event_time)
 *   - sort_order: asc | desc (default: desc)
 */
export async function getExecutions(filters = {}) {
  try {
    const query = {};

    // Filter by playbook_id
    if (filters.playbook_id) {
      query.playbook_id = filters.playbook_id;
    }

    // Filter by state (exact match)
    if (filters.state) {
      query.state = filters.state;
    }

    // Filter by severity (nested field in trigger_data)
    if (filters.severity) {
      if (Array.isArray(filters.severity)) {
        query['trigger_data.severity'] = { $in: filters.severity };
      } else {
        query['trigger_data.severity'] = filters.severity;
      }
    }

    // Filter by rule_id (nested field in trigger_data)
    if (filters.rule_id) {
      query['trigger_data.rule_id'] = filters.rule_id;
    }

    // Filter by trigger_id (nested field in trigger_snapshot)
    if (filters.trigger_id) {
      query['trigger_snapshot.trigger_id'] = filters.trigger_id;
    }

    // Filter by webhook_id
    if (filters.webhook_id) {
      query.webhook_id = filters.webhook_id;
    }

    // Event time range filtering (primary - uses event_time field)
    if (filters.from_time || filters.to_time) {
      query.event_time = {};
      if (filters.from_time) {
        query.event_time.$gte = new Date(filters.from_time);
      }
      if (filters.to_time) {
        query.event_time.$lte = new Date(filters.to_time);
      }
    }

    // Legacy date range filtering on created_at (for backward compatibility)
    if (filters.start_date || filters.end_date) {
      query.created_at = {};
      if (filters.start_date) {
        query.created_at.$gte = new Date(filters.start_date);
      }
      if (filters.end_date) {
        query.created_at.$lte = new Date(filters.end_date);
      }
    }

    // Pagination with limits
    const limit = Math.min(parseInt(filters.limit) || 100, 500);
    const offset = parseInt(filters.offset) || 0;

    // Sorting configuration
    const sortBy = filters.sort_by || 'created_at';
    const sortOrder = filters.sort_order === 'asc' ? 1 : -1;

    // Build sort object with secondary sort on _id for stability
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder;
    sortOptions._id = sortOrder; // Secondary sort for stable pagination

    const executions = await Execution.find(query)
      .sort(sortOptions)
      .limit(limit)
      .skip(offset)
      .lean();

    const total = await Execution.countDocuments(query);

    // Calculate pagination metadata
    const hasNext = offset + limit < total;
    const hasPrev = offset > 0;

    return {
      data: executions.map(e => ({
        ...e,
        id: e._id.toString(),
        // Use the actual execution_id field (human-readable), NOT _id
        execution_id: e.execution_id
      })),
      total,
      limit,
      offset,
      page: Math.floor(offset / limit) + 1,
      page_size: limit,
      has_next: hasNext,
      has_prev: hasPrev
    };
  } catch (error) {
    logger.error('Failed to get executions:', error);
    throw error;
  }
}

/**
 * Get single execution by ID (supports both execution_id and MongoDB _id)
 */
export async function getExecution(id) {
  try {
    const execution = await findExecutionByIdOrLogicalId(id);

    if (!execution) {
      return null;
    }

    const result = execution.toObject ? execution.toObject() : execution;
    return {
      ...result,
      id: result._id.toString(),
      // Use the actual execution_id field (human-readable), NOT _id
      execution_id: result.execution_id
    };
  } catch (error) {
    logger.error(`Failed to get execution ${id}:`, error);
    throw error;
  }
}

/**
 * Create new execution (typically called by webhook or manual trigger)
 */
export async function createExecution(playbookId, triggerData, triggerSource = 'manual') {
  try {
    // Find playbook by playbook_id (logical ID)
    const playbook = await Playbook.findOne({ playbook_id: playbookId });

    if (!playbook) {
      throw new Error('Playbook not found');
    }

    // ALL context is in trigger_data - no alert fields in execution root
    const execution = new Execution({
      playbook_id: playbook.playbook_id,
      playbook_name: playbook.name,
      state: ExecutionState.EXECUTING,
      trigger_data: triggerData,
      trigger_source: triggerSource, // 'webhook', 'manual', 'simulation', 'api'
      started_at: new Date(),
      steps: playbook.steps.map(step => ({
        step_id: step.step_id,
        state: StepState.PENDING
      }))
    });

    await execution.save();

    logger.info(`Execution created: ${execution.execution_id} for playbook: ${playbook.name} (source: ${triggerSource})`);

    return {
      ...execution.toObject(),
      id: execution._id.toString(),
      // Use the actual execution_id field (human-readable), NOT _id
      execution_id: execution.execution_id
    };
  } catch (error) {
    logger.error('Failed to create execution:', error);
    throw error;
  }
}

/**
 * Update execution state (supports both execution_id and MongoDB _id)
 */
export async function updateExecutionState(id, state, error = null) {
  try {
    const execution = await findExecutionByIdOrLogicalId(id);

    if (!execution) {
      throw new Error('Execution not found');
    }

    execution.state = state;

    if (state === ExecutionState.COMPLETED || state === ExecutionState.FAILED) {
      execution.completed_at = new Date();
      if (execution.started_at) {
        execution.duration_ms = execution.completed_at - execution.started_at;
      }

      if (error) {
        execution.error = {
          message: error.message,
          code: error.code || 'EXECUTION_FAILED',
          timestamp: new Date()
        };
      }
    }

    await execution.save();

    logger.info(`Execution ${execution.execution_id} state updated to: ${state}`);

    return {
      ...execution.toObject(),
      id: execution._id.toString(),
      // Use the actual execution_id field (human-readable), NOT _id
      execution_id: execution.execution_id
    };
  } catch (error) {
    logger.error(`Failed to update execution ${id}:`, error);
    throw error;
  }
}

/**
 * Update step state within an execution (supports both execution_id and MongoDB _id)
 */
export async function updateStepState(executionId, stepId, stepState, output = {}, error = null) {
  try {
    const execution = await findExecutionByIdOrLogicalId(executionId);

    if (!execution) {
      throw new Error('Execution not found');
    }

    await execution.updateStepState(stepId, stepState, output, error);

    logger.info(`Step ${stepId} in execution ${execution.execution_id} updated to: ${stepState}`);

    return {
      ...execution.toObject(),
      id: execution._id.toString(),
      // Use the actual execution_id field (human-readable), NOT _id
      execution_id: execution.execution_id
    };
  } catch (error) {
    logger.error(`Failed to update step ${stepId} in execution ${executionId}:`, error);
    throw error;
  }
}

/**
 * Cancel execution (mark as FAILED) - supports both execution_id and MongoDB _id
 */
export async function cancelExecution(id, userId) {
  try {
    const execution = await findExecutionByIdOrLogicalId(id);

    if (!execution) {
      throw new Error('Execution not found');
    }

    if (execution.state === ExecutionState.COMPLETED || execution.state === ExecutionState.FAILED) {
      throw new Error('Cannot cancel completed or failed execution');
    }

    execution.state = ExecutionState.FAILED;
    execution.completed_at = new Date();
    if (execution.started_at) {
      execution.duration_ms = execution.completed_at - execution.started_at;
    }
    execution.error = {
      message: `Cancelled by user: ${userId}`,
      code: 'CANCELLED',
      timestamp: new Date()
    };

    await execution.save();

    logger.info(`Execution ${execution.execution_id} cancelled by ${userId}`);

    return {
      ...execution.toObject(),
      id: execution._id.toString(),
      // Use the actual execution_id field (human-readable), NOT _id
      execution_id: execution.execution_id
    };
  } catch (error) {
    logger.error(`Failed to cancel execution ${id}:`, error);
    throw error;
  }
}

/**
 * Get execution statistics (LEGACY - use getExecutionStatsDetailed for new API)
 */
export async function getExecutionStats(playbookId = null, timeRange = '24h') {
  try {
    const query = {};

    if (playbookId) {
      query.playbook_id = playbookId;
    }

    // Calculate time range
    const now = new Date();
    const rangeMs = {
      '1h': 3600000,
      '24h': 86400000,
      '7d': 604800000,
      '30d': 2592000000
    }[timeRange] || 86400000;

    query.created_at = { $gte: new Date(now - rangeMs) };

    const [total, completed, failed, executing, waiting] = await Promise.all([
      Execution.countDocuments(query),
      Execution.countDocuments({ ...query, state: ExecutionState.COMPLETED }),
      Execution.countDocuments({ ...query, state: ExecutionState.FAILED }),
      Execution.countDocuments({ ...query, state: ExecutionState.EXECUTING }),
      Execution.countDocuments({ ...query, state: ExecutionState.WAITING_APPROVAL })
    ]);

    // Get average execution time
    const completedExecutions = await Execution.find({
      ...query,
      state: ExecutionState.COMPLETED,
      duration_ms: { $exists: true }
    }).select('duration_ms').lean();

    const avgDuration = completedExecutions.length > 0
      ? completedExecutions.reduce((sum, e) => sum + e.duration_ms, 0) / completedExecutions.length
      : 0;

    return {
      total,
      completed,
      failed,
      executing,
      waiting_approval: waiting,
      success_rate: total > 0 ? (completed / total * 100).toFixed(2) : 0,
      avg_duration_ms: Math.round(avgDuration),
      time_range: timeRange
    };
  } catch (error) {
    logger.error('Failed to get execution stats:', error);
    throw error;
  }
}

/**
 * Get detailed execution statistics with severity breakdown
 * Uses MongoDB aggregation pipeline for efficiency
 *
 * Returns:
 *   - active_count: Currently executing executions
 *   - waiting_approval_count: Executions waiting for approval
 *   - completed_today: Completed executions in last 24h
 *   - failed_today: Failed executions in last 24h
 *   - severity_breakdown: Count by severity (critical, high, medium, low)
 */
export async function getExecutionStatsDetailed() {
  try {
    // Define "today" using UTC boundaries (last 24 hours)
    const now = new Date();
    const todayStart = new Date(now.getTime() - 86400000); // 24 hours ago

    // Use aggregation pipeline for efficient counting
    const stats = await Execution.aggregate([
      {
        $facet: {
          // Active executions (currently executing)
          active: [
            { $match: { state: ExecutionState.EXECUTING } },
            { $count: 'count' }
          ],
          // Waiting for approval
          waiting_approval: [
            { $match: { state: ExecutionState.WAITING_APPROVAL } },
            { $count: 'count' }
          ],
          // Completed today
          completed_today: [
            {
              $match: {
                state: ExecutionState.COMPLETED,
                completed_at: { $gte: todayStart }
              }
            },
            { $count: 'count' }
          ],
          // Failed today
          failed_today: [
            {
              $match: {
                state: ExecutionState.FAILED,
                completed_at: { $gte: todayStart }
              }
            },
            { $count: 'count' }
          ],
          // Severity breakdown (all executions)
          severity_breakdown: [
            {
              $group: {
                _id: '$trigger_data.severity',
                count: { $sum: 1 }
              }
            }
          ]
        }
      }
    ]);

    // Extract results from aggregation
    const result = stats[0];

    const activeCount = result.active[0]?.count || 0;
    const waitingApprovalCount = result.waiting_approval[0]?.count || 0;
    const completedToday = result.completed_today[0]?.count || 0;
    const failedToday = result.failed_today[0]?.count || 0;

    // Build severity breakdown object
    const severityBreakdown = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0
    };

    result.severity_breakdown.forEach(item => {
      const severity = item._id?.toLowerCase();
      if (severity && severityBreakdown.hasOwnProperty(severity)) {
        severityBreakdown[severity] = item.count;
      }
    });

    return {
      active_count: activeCount,
      waiting_approval_count: waitingApprovalCount,
      completed_today: completedToday,
      failed_today: failedToday,
      severity_breakdown: severityBreakdown
    };
  } catch (error) {
    logger.error('Failed to get detailed execution stats:', error);
    throw error;
  }
}

export default {
  getExecutions,
  getExecution,
  createExecution,
  updateExecutionState,
  updateStepState,
  cancelExecution,
  getExecutionStats,
  getExecutionStatsDetailed
};
