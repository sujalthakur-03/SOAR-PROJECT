/**
 * Approval Step Executor
 * Creates approval requests that require human decision
 */

import supabase, { createAuditLog } from '../utils/database.js';
import logger from '../utils/logger.js';
import { generateId } from '../utils/helpers.js';

/**
 * Execute approval step (creates approval request and waits)
 */
export async function executeApproval(step, alert, context, execution) {
  logger.info(`Executing approval step: ${step.name}`);

  const config = step.config;
  const requiredRole = config.required_role || 'senior_analyst';
  const timeoutHours = config.timeout_hours || config.timeout_minutes / 60 || 1;

  try {
    // Create approval request
    const approvalId = generateId('APR');
    const expiresAt = new Date(Date.now() + timeoutHours * 60 * 60 * 1000);

    const proposedAction = step.name || 'Approval Required';
    const actionDetails = {
      step: step.name,
      execution_id: execution.id,
      alert_summary: {
        rule_name: alert.rule_name,
        severity: alert.severity,
        source_ip: alert.source_ip,
        agent_name: alert.agent_name
      },
      context: context
    };

    const { data: approval, error } = await supabase
      .from('approvals')
      .insert({
        approval_id: approvalId,
        execution_id: execution.id,
        alert_id: alert.id,
        playbook_name: execution.playbook_name,
        proposed_action: proposedAction,
        action_details: actionDetails,
        status: 'pending',
        requested_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    // Create audit log
    await createAuditLog({
      action: 'approval.create',
      resource_type: 'approval',
      resource_id: approvalId,
      details: {
        execution_id: execution.id,
        playbook_name: execution.playbook_name,
        required_role: requiredRole
      },
      outcome: 'success'
    });

    logger.info(`✅ Approval request created: ${approvalId}`);

    // Return approval info - the execution engine will pause here
    return {
      success: true,
      approval_id: approvalId,
      status: 'pending',
      expires_at: expiresAt.toISOString(),
      output: {
        approval_id: approvalId,
        status: 'pending'
      }
    };

  } catch (error) {
    logger.error(`❌ Approval step failed: ${step.name}`, error);
    throw error;
  }
}

/**
 * Check approval status
 */
export async function checkApprovalStatus(approvalId) {
  try {
    const { data, error } = await supabase
      .from('approvals')
      .select('*')
      .eq('approval_id', approvalId)
      .single();

    if (error) throw error;

    return {
      status: data.status,
      decided_by: data.decided_by,
      decided_at: data.decided_at,
      reason: data.reason
    };
  } catch (error) {
    logger.error(`Failed to check approval status for ${approvalId}:`, error);
    throw error;
  }
}

export default {
  executeApproval,
  checkApprovalStatus
};
