/**
 * Playbook Execution Engine
 * Core orchestration logic for executing playbook workflows
 */

import supabase, { createAuditLog } from '../utils/database.js';
import logger from '../utils/logger.js';
import { generateId } from '../utils/helpers.js';
import { ExecutionState, StepState, StepType } from '../types/index.js';

import { executeEnrichment } from '../executors/enrichment.js';
import { executeCondition } from '../executors/condition.js';
import { executeApproval, checkApprovalStatus } from '../executors/approval.js';
import { executeAction } from '../executors/action.js';
import { executeNotification } from '../executors/notification.js';

/**
 * Execute a playbook for a given alert
 */
export async function executePlaybook(playbook, alert) {
  logger.info(`🚀 Starting playbook execution: ${playbook.name} for alert ${alert.alert_id}`);

  try {
    // Create execution record
    const execution = await createExecution(playbook, alert);

    // Start execution in background
    processExecution(execution, playbook, alert).catch(error => {
      logger.error(`Execution ${execution.execution_id} failed:`, error);
      updateExecutionState(execution.id, ExecutionState.FAILED, null, error.message);
    });

    return execution;

  } catch (error) {
    logger.error(`Failed to start playbook execution:`, error);
    throw error;
  }
}

/**
 * Create execution record in database
 */
async function createExecution(playbook, alert) {
  const executionId = generateId('EXE');

  const { data, error } = await supabase
    .from('executions')
    .insert({
      execution_id: executionId,
      playbook_id: playbook.id,
      playbook_name: playbook.name,
      alert_id: alert.id,
      state: ExecutionState.CREATED,
      current_step: 0,
      steps: playbook.steps.map(step => ({
        step_id: step.id,
        step_name: step.name,
        type: step.type,
        state: StepState.PENDING,
        input: {}
      })),
      started_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw error;

  await createAuditLog({
    action: 'execution.create',
    resource_type: 'execution',
    resource_id: executionId,
    details: {
      playbook_id: playbook.id,
      playbook_name: playbook.name,
      alert_id: alert.alert_id
    },
    outcome: 'success'
  });

  logger.info(`✅ Execution created: ${executionId}`);
  return data;
}

/**
 * Process execution steps
 */
async function processExecution(execution, playbook, alert) {
  const context = {
    alert_id: alert.alert_id,
    source_ip: alert.source_ip,
    destination_ip: alert.destination_ip,
    agent_id: alert.agent_id,
    agent_name: alert.agent_name,
    severity: alert.severity
  };

  const steps = playbook.steps.sort((a, b) => a.order - b.order);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    try {
      // Update execution state based on step type
      if (step.type === StepType.ENRICHMENT && execution.state !== ExecutionState.ENRICHING) {
        await updateExecutionState(execution.id, ExecutionState.ENRICHING, i);
      } else if (step.type === StepType.APPROVAL) {
        await updateExecutionState(execution.id, ExecutionState.WAITING_APPROVAL, i);
      } else if (execution.state === ExecutionState.CREATED || execution.state === ExecutionState.ENRICHING) {
        await updateExecutionState(execution.id, ExecutionState.EXECUTING, i);
      }

      // Update step state to running
      await updateStepState(execution.id, i, StepState.RUNNING, {
        started_at: new Date().toISOString()
      });

      // Execute step based on type
      const result = await executeStep(step, alert, context, execution);

      // Handle approval steps specially
      if (step.type === StepType.APPROVAL) {
        // Wait for approval decision
        const approved = await waitForApproval(result.approval_id, step.config.timeout_hours || 1);

        if (!approved) {
          logger.warn(`Approval rejected or expired for ${result.approval_id}`);
          await updateStepState(execution.id, i, StepState.FAILED, {
            completed_at: new Date().toISOString(),
            error: 'Approval rejected or expired'
          });

          // Stop execution
          await updateExecutionState(
            execution.id,
            ExecutionState.FAILED,
            i,
            'Approval rejected or expired'
          );
          return;
        }
      }

      // Handle condition results
      if (step.type === StepType.CONDITION && result.output?.next_step) {
        const nextStepId = result.output.next_step;

        // Mark current step as completed
        await updateStepState(execution.id, i, StepState.COMPLETED, {
          completed_at: new Date().toISOString(),
          output: result.output
        });

        // Find next step index
        const nextStepIndex = steps.findIndex(s => s.id === nextStepId);
        if (nextStepIndex === -1) {
          logger.warn(`Next step ${nextStepId} not found, continuing to next sequential step`);
        } else if (nextStepIndex !== i + 1) {
          // Skip to the specified step
          i = nextStepIndex - 1; // -1 because loop will increment
          continue;
        }
      } else {
        // Update step state to completed
        await updateStepState(execution.id, i, StepState.COMPLETED, {
          completed_at: new Date().toISOString(),
          output: result.output
        });
      }

    } catch (error) {
      logger.error(`Step ${step.name} failed:`, error);

      await updateStepState(execution.id, i, StepState.FAILED, {
        completed_at: new Date().toISOString(),
        error: error.message
      });

      // Check on_failure behavior
      if (step.on_failure === 'stop') {
        await updateExecutionState(execution.id, ExecutionState.FAILED, i, error.message);
        return;
      } else if (step.on_failure === 'skip') {
        // Continue to next step
        continue;
      }
      // 'continue' or default: log error but continue
    }
  }

  // All steps completed
  await updateExecutionState(execution.id, ExecutionState.COMPLETED);

  await createAuditLog({
    action: 'execution.complete',
    resource_type: 'execution',
    resource_id: execution.execution_id,
    details: {
      playbook_name: playbook.name,
      duration_ms: Date.now() - new Date(execution.started_at).getTime()
    },
    outcome: 'success'
  });

  // Update playbook execution count
  await supabase
    .from('playbooks')
    .update({
      execution_count: playbook.execution_count + 1,
      last_execution: new Date().toISOString()
    })
    .eq('id', playbook.id);

  logger.info(`✅ Playbook execution completed: ${execution.execution_id}`);
}

/**
 * Execute a single step
 */
async function executeStep(step, alert, context, execution) {
  logger.info(`Executing step: ${step.name} (type: ${step.type})`);

  switch (step.type) {
    case StepType.ENRICHMENT:
      return await executeEnrichment(step, alert, context);

    case StepType.CONDITION:
      return await executeCondition(step, alert, context);

    case StepType.APPROVAL:
      return await executeApproval(step, alert, context, execution);

    case StepType.ACTION:
      return await executeAction(step, alert, context);

    case StepType.NOTIFICATION:
      return await executeNotification(step, alert, context);

    default:
      throw new Error(`Unknown step type: ${step.type}`);
  }
}

/**
 * Wait for approval decision
 */
async function waitForApproval(approvalId, timeoutHours) {
  const timeoutMs = timeoutHours * 60 * 60 * 1000;
  const startTime = Date.now();
  const pollInterval = 5000; // Check every 5 seconds

  while (Date.now() - startTime < timeoutMs) {
    const status = await checkApprovalStatus(approvalId);

    if (status.status === 'approved') {
      logger.info(`✅ Approval ${approvalId} approved by ${status.decided_by}`);
      return true;
    } else if (status.status === 'rejected') {
      logger.warn(`❌ Approval ${approvalId} rejected by ${status.decided_by}`);
      return false;
    } else if (status.status === 'expired') {
      logger.warn(`⏰ Approval ${approvalId} expired`);
      return false;
    }

    // Still pending, wait and check again
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  // Timeout reached
  logger.warn(`⏰ Approval ${approvalId} timed out`);

  // Mark approval as expired
  await supabase
    .from('approvals')
    .update({ status: 'expired' })
    .eq('approval_id', approvalId);

  return false;
}

/**
 * Update execution state
 */
async function updateExecutionState(executionId, state, currentStep = null, error = null) {
  const updates = {
    state,
    ...(currentStep !== null && { current_step: currentStep }),
    ...(state === ExecutionState.COMPLETED && { completed_at: new Date().toISOString() }),
    ...(state === ExecutionState.FAILED && {
      completed_at: new Date().toISOString(),
      error
    })
  };

  const { error: updateError } = await supabase
    .from('executions')
    .update(updates)
    .eq('id', executionId);

  if (updateError) {
    logger.error('Failed to update execution state:', updateError);
  }
}

/**
 * Update step state
 */
async function updateStepState(executionId, stepIndex, state, additionalData = {}) {
  // Fetch current execution
  const { data: execution, error: fetchError } = await supabase
    .from('executions')
    .select('steps')
    .eq('id', executionId)
    .single();

  if (fetchError) throw fetchError;

  // Update step
  const steps = execution.steps;
  steps[stepIndex] = {
    ...steps[stepIndex],
    state,
    ...additionalData
  };

  // Save back
  const { error: updateError } = await supabase
    .from('executions')
    .update({ steps })
    .eq('id', executionId);

  if (updateError) {
    logger.error('Failed to update step state:', updateError);
  }
}

export default {
  executePlaybook
};
