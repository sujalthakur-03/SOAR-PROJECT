/**
 * Approval Service
 * Business logic for approval operations with MongoDB
 *
 * EXECUTION STATE VALUES (CANONICAL):
 *   - EXECUTING: Currently running
 *   - WAITING_APPROVAL: Paused waiting for approval
 *   - COMPLETED: Successfully finished
 *   - FAILED: Execution failed
 */

import { Approval, Execution, AuditLog, ExecutionState } from '../models/index.js';
import logger from '../utils/logger.js';

/**
 * Create approval request for execution
 */
export async function createApproval(executionId, stepId, reason, requiredRole = 'security_admin', expiresInHours = 24) {
  try {
    const execution = await Execution.findById(executionId);

    if (!execution) {
      throw new Error('Execution not found');
    }

    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    // Extract context from trigger_data
    const triggerData = execution.trigger_data || {};

    const approval = new Approval({
      execution_id: execution._id,
      playbook_id: execution.playbook_id,
      step_id: stepId,
      status: 'pending',
      trigger_context: {
        alert_type: triggerData.alert_type || triggerData.type || 'unknown',
        severity: triggerData.severity || 'medium',
        source: triggerData.source || 'unknown'
      },
      required_role: requiredRole,
      reason: reason,
      expires_at: expiresAt
    });

    await approval.save();

    // Update execution state to WAITING_APPROVAL
    await execution.waitForApproval(approval._id);

    await AuditLog.log({
      action: 'create',
      resource_type: 'approval',
      resource_id: approval._id.toString(),
      details: {
        execution_id: executionId,
        step_id: stepId,
        expires_at: expiresAt
      },
      outcome: 'success'
    });

    logger.info(`Approval created: ${approval._id} for execution: ${executionId}`);

    return {
      ...approval.toObject(),
      id: approval._id.toString(),
      approval_id: approval._id.toString()
    };
  } catch (error) {
    logger.error('Failed to create approval:', error);
    throw error;
  }
}

/**
 * Get all approvals with optional filters
 */
export async function getApprovals(filters = {}) {
  try {
    const query = {};

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.execution_id) {
      query.execution_id = filters.execution_id;
    }

    if (filters.playbook_id) {
      query.playbook_id = filters.playbook_id;
    }

    const limit = parseInt(filters.limit) || 100;
    const offset = parseInt(filters.offset) || 0;

    const approvals = await Approval.find(query)
      .sort({ created_at: -1 })
      .limit(limit)
      .skip(offset)
      .lean();

    const total = await Approval.countDocuments(query);

    return {
      data: approvals.map(a => ({
        ...a,
        id: a._id.toString(),
        approval_id: a._id.toString()
      })),
      total,
      limit,
      offset
    };
  } catch (error) {
    logger.error('Failed to get approvals:', error);
    throw error;
  }
}

/**
 * Get single approval by ID
 */
export async function getApproval(id) {
  try {
    const approval = await Approval.findById(id).lean();

    if (!approval) {
      return null;
    }

    return {
      ...approval,
      id: approval._id.toString(),
      approval_id: approval._id.toString()
    };
  } catch (error) {
    logger.error(`Failed to get approval ${id}:`, error);
    throw error;
  }
}

/**
 * Approve a pending approval
 */
export async function approveAction(id, userId, note = '') {
  try {
    const approval = await Approval.findById(id);

    if (!approval) {
      throw new Error('Approval not found');
    }

    if (approval.status !== 'pending') {
      throw new Error(`Cannot approve approval in status: ${approval.status}`);
    }

    if (approval.isExpired()) {
      approval.status = 'expired';
      await approval.save();
      throw new Error('Approval has expired');
    }

    await approval.approve(userId, note);

    // Update execution to continue (EXECUTING state)
    const execution = await Execution.findById(approval.execution_id);
    if (execution && execution.state === ExecutionState.WAITING_APPROVAL) {
      execution.state = ExecutionState.EXECUTING;
      await execution.save();
    }

    await AuditLog.log({
      action: 'approve',
      resource_type: 'approval',
      resource_id: approval._id.toString(),
      actor_email: userId,
      details: {
        execution_id: approval.execution_id.toString(),
        note: note
      },
      outcome: 'success'
    });

    logger.info(`Approval ${id} approved by ${userId}`);

    return {
      ...approval.toObject(),
      id: approval._id.toString(),
      approval_id: approval._id.toString()
    };
  } catch (error) {
    logger.error(`Failed to approve ${id}:`, error);
    throw error;
  }
}

/**
 * Reject a pending approval
 */
export async function rejectAction(id, userId, note = '') {
  try {
    const approval = await Approval.findById(id);

    if (!approval) {
      throw new Error('Approval not found');
    }

    if (approval.status !== 'pending') {
      throw new Error(`Cannot reject approval in status: ${approval.status}`);
    }

    await approval.reject(userId, note);

    // Update execution to FAILED
    const execution = await Execution.findById(approval.execution_id);
    if (execution && execution.state === ExecutionState.WAITING_APPROVAL) {
      await execution.fail(new Error('Approval rejected'), approval.step_id);
    }

    await AuditLog.log({
      action: 'reject',
      resource_type: 'approval',
      resource_id: approval._id.toString(),
      actor_email: userId,
      details: {
        execution_id: approval.execution_id.toString(),
        note: note
      },
      outcome: 'success'
    });

    logger.info(`Approval ${id} rejected by ${userId}`);

    return {
      ...approval.toObject(),
      id: approval._id.toString(),
      approval_id: approval._id.toString()
    };
  } catch (error) {
    logger.error(`Failed to reject ${id}:`, error);
    throw error;
  }
}

/**
 * Check and expire old approvals
 */
export async function expireOldApprovals() {
  try {
    const now = new Date();
    const expiredApprovals = await Approval.find({
      status: 'pending',
      expires_at: { $lte: now }
    });

    for (const approval of expiredApprovals) {
      approval.status = 'expired';
      await approval.save();

      // Fail associated execution
      const execution = await Execution.findById(approval.execution_id);
      if (execution && execution.state === ExecutionState.WAITING_APPROVAL) {
        await execution.fail(new Error('Approval expired'), approval.step_id);
      }

      logger.info(`Approval ${approval._id} expired`);
    }

    return expiredApprovals.length;
  } catch (error) {
    logger.error('Failed to expire old approvals:', error);
    throw error;
  }
}

export default {
  createApproval,
  getApprovals,
  getApproval,
  approveAction,
  rejectAction,
  expireOldApprovals
};
