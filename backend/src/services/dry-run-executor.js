/**
 * Dry-Run Executor - Phase 3.0 Approval-Gated Automation
 *
 * CRITICAL SAFETY GUARANTEE:
 * - This module SIMULATES what WOULD happen
 * - NO external APIs are called
 * - NO real actions are executed
 * - NO side effects are produced
 * - Output is LOGGED and STORED only
 *
 * Purpose: Show analysts what automated playbook would do WITHOUT doing it
 */

import { Execution, AuditLog } from '../models/index.js';
import { ExecutionState, StepState } from '../models/execution.js';
import logger from '../utils/logger.js';

/**
 * Generate dry-run execution plan from approved playbook
 *
 * @param {Object} approval - Approved approval record
 * @returns {Promise<Object>} Dry-run execution result
 */
export async function executeDryRun(approval) {
  try {
    const execution = await Execution.findById(approval.execution_id);
    if (!execution) {
      throw new Error('Execution not found for dry-run');
    }

    logger.info(`[DRY-RUN] ════════════════════════════════════════════════════`);
    logger.info(`[DRY-RUN] Starting simulation for Approval ${approval._id}`);
    logger.info(`[DRY-RUN] Execution: ${execution.execution_id}`);
    logger.info(`[DRY-RUN] Playbook: ${execution.playbook_name}`);
    logger.info(`[DRY-RUN] Mode: DRY-RUN ONLY (NO REAL ACTIONS)`);
    logger.info(`[DRY-RUN] ════════════════════════════════════════════════════`);

    const startTime = Date.now();
    const steps = [];

    // Simulate each step in the execution
    for (let i = 0; i < execution.steps.length; i++) {
      const step = execution.steps[i];
      const simulatedStep = await simulateStep(step, execution.trigger_data, i + 1);
      steps.push(simulatedStep);

      logger.info(`[DRY-RUN] Step ${i + 1}/${execution.steps.length}: ${simulatedStep.description}`);
      logger.info(`[DRY-RUN]   Status: ${simulatedStep.status}`);
      logger.info(`[DRY-RUN]   [NO-EXECUTION] This is a simulation only`);
    }

    const duration = Date.now() - startTime;

    // Update execution with dry-run results
    // Use canonical state values: SKIPPED for steps, COMPLETED for execution
    execution.steps = steps.map((sim, idx) => ({
      ...execution.steps[idx],
      state: StepState.SKIPPED,
      output: sim.details,
      completed_at: new Date(),
      duration_ms: 0
    }));
    execution.state = ExecutionState.COMPLETED;
    execution.completed_at = new Date();
    execution.duration_ms = duration;
    await execution.save();

    // Audit log - use human-readable execution_id
    await AuditLog.log({
      action: 'execute',
      resource_type: 'execution',
      resource_id: execution.execution_id,
      details: {
        mode: 'dry-run',
        approval_id: approval._id.toString(),
        steps_count: steps.length,
        duration_ms: duration
      },
      outcome: 'success'
    });

    logger.info(`[DRY-RUN] ════════════════════════════════════════════════════`);
    logger.info(`[DRY-RUN] Simulation complete: ${execution.execution_id}`);
    logger.info(`[DRY-RUN] Total steps: ${steps.length}`);
    logger.info(`[DRY-RUN] Duration: ${duration}ms`);
    logger.info(`[DRY-RUN] [NO-EXECUTION] No real actions were performed`);
    logger.info(`[DRY-RUN] ════════════════════════════════════════════════════`);

    return {
      ...execution.toObject(),
      id: execution._id.toString(),
      // Use human-readable execution_id, NOT MongoDB _id
      execution_id: execution.execution_id
    };
  } catch (error) {
    logger.error('[DRY-RUN] Simulation failed:', error);
    throw error;
  }
}

/**
 * Simulate a single playbook step
 *
 * @param {Object} step - Execution step
 * @param {Object} triggerData - Alert context
 * @param {number} stepNumber - Step number
 * @returns {Promise<Object>} Simulated step result
 */
async function simulateStep(step, triggerData, stepNumber) {
  const simulated = {
    step_number: stepNumber,
    step_id: step.step_id,
    description: `[DRY-RUN] Would execute step: ${step.step_id}`,
    status: 'would_succeed',
    simulated_at: new Date().toISOString(),
    safety_note: 'DRY-RUN: No real action executed',
    details: {}
  };

  // Extract common fields from trigger data
  const sourceIp = triggerData.source_ip || triggerData.data?.source_ip || 'N/A';
  const agentName = triggerData.agent?.name || triggerData.agent_name || 'N/A';
  const ruleName = triggerData.rule?.name || triggerData.rule_name || 'N/A';

  // Simulate different action types based on step_id patterns
  if (step.step_id.includes('block') || step.step_id.includes('firewall')) {
    simulated.description = `Would block IP ${sourceIp} on firewall`;
    simulated.details = {
      target_ip: sourceIp,
      firewall_rule: 'BLOCK_MALICIOUS_IP',
      duration: 'permanent'
    };
  } else if (step.step_id.includes('isolate') || step.step_id.includes('quarantine')) {
    simulated.description = `Would isolate host ${agentName} from network`;
    simulated.details = {
      hostname: agentName,
      isolation_type: 'network_quarantine',
      reversible: true
    };
  } else if (step.step_id.includes('slack') || step.step_id.includes('notify')) {
    simulated.description = `Would send notification`;
    simulated.details = {
      channel: '#soc-alerts',
      message_preview: `Alert ${ruleName} detected`
    };
  } else if (step.step_id.includes('email')) {
    simulated.description = `Would send email notification`;
    simulated.details = {
      to: 'soc@example.com',
      subject: `Alert: ${ruleName}`,
      priority: 'normal'
    };
  } else if (step.step_id.includes('ticket')) {
    simulated.description = `Would create ticket`;
    simulated.details = {
      system: 'ticketing',
      priority: 'medium',
      assignee: 'auto-assign'
    };
  } else {
    simulated.description = `Would execute step: ${step.step_id}`;
    simulated.details = {
      step_id: step.step_id,
      note: 'Generic simulation'
    };
  }

  return simulated;
}

export default {
  executeDryRun
};
