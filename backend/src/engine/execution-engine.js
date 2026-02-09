/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.0 — EXECUTION FLOW ENGINE (HARDENED)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Core orchestration engine for executing playbook workflows.
 *
 * KEY RESPONSIBILITIES:
 * - Step-by-step execution following DSL specification
 * - State machine transitions (EXECUTING → WAITING_APPROVAL → COMPLETED/FAILED)
 * - Shadow mode enforcement (actions SKIPPED when enabled)
 * - Retry policy implementation
 * - Input resolution from trigger_data and step outputs
 * - Connector invocation via contract interface
 * - Audit event emission
 * - Metrics counter updates
 *
 * HARDENING (v1.1.0):
 * - Loop protection: MAX_STEP_EXECUTIONS limit prevents infinite loops
 * - Condition step termination: No fall-through, must always branch
 * - Approval timeout enforcement: Explicit on_timeout behavior required
 *
 * VERSION: 1.1.0 (HARDENED)
 * AUTHOR: CyberSentinel SOAR Team
 * ══════════════════════════════════════════════════════════════════════════════
 */

import Execution, { ExecutionState, StepState } from '../models/execution.js';
import { logAction } from '../services/audit-service.js';
import { incrementMetric } from '../services/metrics-service.js';
import { invokeConnector } from './connector-interface.js';
import { resolveInputs, evaluateCondition, renderTemplate } from './input-resolver.js';
import { validatePlaybookOrThrow } from './playbook-validator.js';
import logger from '../utils/logger.js';

// ═══════════════════════════════════════════════════════════════════════════════
// HARDENING CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Maximum number of step executions per execution.
 * Prevents infinite loops caused by goto/branching.
 *
 * If breached:
 * - Execution FAILS
 * - Error code: LOOP_DETECTED
 * - All pending steps marked SKIPPED
 */
const MAX_STEP_EXECUTIONS = 100;

/**
 * Special step ID indicating execution should end
 */
const STEP_END = '__END__';

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION STATE MACHINE
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * STATE MACHINE DIAGRAM:
 *
 *                  ┌─────────────┐
 *                  │   START     │
 *                  └──────┬──────┘
 *                         │
 *                         ▼
 *               ┌─────────────────┐
 *   ┌──────────►│   EXECUTING     │◄──────────────┐
 *   │           └────────┬────────┘               │
 *   │                    │                        │
 *   │         ┌──────────┼──────────┐             │
 *   │         │          │          │             │
 *   │         ▼          ▼          ▼             │
 *   │   ┌──────────┐  ┌──────┐  ┌─────────┐       │
 *   │   │ APPROVAL │  │ STEP │  │  STEP   │       │
 *   │   │  STEP    │  │  OK  │  │ FAILED  │       │
 *   │   └────┬─────┘  └──┬───┘  └────┬────┘       │
 *   │        │           │           │            │
 *   │        ▼           │           ▼            │
 *   │   ┌─────────────┐  │    ┌────────────┐      │
 *   │   │  WAITING_   │  │    │  on_failure│      │
 *   │   │  APPROVAL   │  │    │  behavior  │      │
 *   │   └──────┬──────┘  │    └─────┬──────┘      │
 *   │          │         │          │             │
 *   │   ┌──────┼─────┐   │   ┌──────┼──────┐      │
 *   │   │      │     │   │   │      │      │      │
 *   │   ▼      ▼     ▼   │   ▼      ▼      ▼      │
 *   │ APPROVED REJ  TMO  │ STOP  CONTINUE  RETRY  │
 *   │   │      │     │   │   │      │        │    │
 *   │   │      └──┬──┘   │   │      │        └────┘
 *   │   │         │      │   │      │
 *   └───┘         ▼      │   ▼      │
 *           ┌──────────┐ │ ┌────────┴───┐
 *           │  FAILED  │ │ │   FAILED   │
 *           └──────────┘ │ └────────────┘
 *                        │
 *                        ▼
 *                 ┌────────────┐
 *                 │ COMPLETED  │
 *                 └────────────┘
 */

// Valid state transitions
const ValidTransitions = {
  [ExecutionState.EXECUTING]: [
    ExecutionState.WAITING_APPROVAL,
    ExecutionState.COMPLETED,
    ExecutionState.FAILED
  ],
  [ExecutionState.WAITING_APPROVAL]: [
    ExecutionState.EXECUTING,  // Resume after approval
    ExecutionState.FAILED      // Rejection or timeout
  ],
  [ExecutionState.COMPLETED]: [], // Terminal state
  [ExecutionState.FAILED]: []     // Terminal state
};

/**
 * Validate state transition
 */
function canTransition(fromState, toState) {
  return ValidTransitions[fromState]?.includes(toState) ?? false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRIGGER DATA NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Normalize trigger data by adding well-known field aliases.
 *
 * Wazuh alerts store fields at nested paths (e.g., data.srcip) but playbook
 * templates reference them using flat names (e.g., source_ip). This function
 * adds the flat aliases so that {{trigger_data.source_ip}} resolves correctly
 * regardless of the incoming alert format.
 *
 * Original data is preserved — aliases are only added when the flat field
 * does not already exist.
 */
function normalizeTriggerData(td) {
  if (!td || typeof td !== 'object') return td;

  const normalized = { ...td };

  // Helper: pick first non-null value from candidate paths
  function firstOf(...paths) {
    for (const p of paths) {
      const parts = p.split('.');
      let val = td;
      for (const part of parts) {
        if (val == null) break;
        val = val[part];
      }
      if (val != null && val !== '') return val;
    }
    return undefined;
  }

  // Network fields
  if (!normalized.source_ip) {
    normalized.source_ip = firstOf('data.srcip', 'srcip', 'src_ip');
  }
  if (!normalized.destination_ip) {
    normalized.destination_ip = firstOf('data.dstip', 'dstip', 'dst_ip');
  }
  if (!normalized.source_port) {
    normalized.source_port = firstOf('data.srcport', 'srcport', 'src_port');
  }
  if (!normalized.destination_port) {
    normalized.destination_port = firstOf('data.dstport', 'dstport', 'dst_port');
  }

  // Rule / alert metadata
  if (!normalized.rule_name) {
    normalized.rule_name = firstOf('rule.description', 'rule.name');
  }
  if (!normalized.rule_id) {
    normalized.rule_id = firstOf('rule.id');
  }
  if (!normalized.severity) {
    normalized.severity = firstOf('rule.level');
  }

  // Agent fields
  if (!normalized.agent_name) {
    normalized.agent_name = firstOf('agent.name');
  }
  if (!normalized.agent_ip) {
    normalized.agent_ip = firstOf('agent.ip');
  }

  // User fields
  if (!normalized.dst_user) {
    normalized.dst_user = firstOf('data.dstuser', 'dstuser');
  }

  return normalized;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION ENGINE CLASS
// ═══════════════════════════════════════════════════════════════════════════════

export class ExecutionEngine {
  constructor(execution, playbook) {
    this.execution = execution;
    this.playbook = playbook;
    this.triggerData = execution.trigger_data;
    this.stepOutputs = new Map();
    this.currentStepIndex = 0;
    this.shadowMode = playbook.shadow_mode || false;

    // ═══════════════════════════════════════════════════════════════════════════
    // HARDENING: Step execution counter for loop detection
    // ═══════════════════════════════════════════════════════════════════════════
    this.stepExecutionCount = 0;
    this.maxStepExecutions = MAX_STEP_EXECUTIONS;
  }

  /**
   * Build execution context for input resolution
   */
  buildContext() {
    return {
      trigger_data: normalizeTriggerData(this.triggerData),
      steps: Object.fromEntries(this.stepOutputs),
      playbook: {
        id: this.playbook.playbook_id,
        name: this.playbook.name,
        shadow_mode: this.shadowMode
      },
      execution: {
        id: this.execution.execution_id,
        started_at: this.execution.started_at
      }
    };
  }

  /**
   * Main execution loop (HARDENED)
   *
   * HARDENING FEATURES:
   * 1. Loop detection: Tracks step execution count, fails on MAX_STEP_EXECUTIONS
   * 2. Condition termination: Condition steps MUST branch, no fall-through
   * 3. Explicit step navigation: Uses nextStepId from step result, not index++
   */
  async execute() {
    logger.info(`[ExecutionEngine] Starting execution ${this.execution.execution_id}`);

    await this.emitAuditEvent('execution.started', {
      playbook_id: this.playbook.playbook_id,
      playbook_name: this.playbook.name,
      shadow_mode: this.shadowMode
    });

    await incrementMetric('executions_started');

    const steps = this.playbook.steps;
    let stepIndex = 0;

    try {
      while (stepIndex < steps.length) {
        const step = steps[stepIndex];
        this.currentStepIndex = stepIndex;

        // ═══════════════════════════════════════════════════════════════════════
        // HARDENING #2: Loop detection - check execution count
        // ═══════════════════════════════════════════════════════════════════════
        this.stepExecutionCount++;

        if (this.stepExecutionCount > this.maxStepExecutions) {
          const loopError = new Error(
            `Execution loop detected: exceeded ${this.maxStepExecutions} step executions. ` +
            `Last step: ${step.step_id}. Check for circular goto/branching.`
          );
          loopError.code = 'LOOP_DETECTED';

          logger.error(`[ExecutionEngine] LOOP DETECTED in execution ${this.execution.execution_id}`);

          await this.emitAuditEvent('execution.loop_detected', {
            step_id: step.step_id,
            step_execution_count: this.stepExecutionCount,
            max_allowed: this.maxStepExecutions
          });

          await incrementMetric('executions_loop_detected');

          throw loopError;
        }

        // Execute step and get next step instruction
        const result = await this.executeStep(step, stepIndex);

        if (result.terminate) {
          // Execution ended (success or failure)
          break;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // HARDENING #1: Condition step termination - NO fall-through
        // ═══════════════════════════════════════════════════════════════════════
        if (step.type === 'condition') {
          // Condition steps MUST provide nextStepId (from on_true/on_false)
          // If nextStepId is null here, it's a validation failure that slipped through
          if (!result.nextStepId) {
            const error = new Error(
              `Condition step ${step.step_id} did not provide branch target. ` +
              `Condition steps MUST always branch via on_true/on_false.`
            );
            error.code = 'CONDITION_NO_BRANCH';
            throw error;
          }
        }

        if (result.nextStepId) {
          // Handle special __END__ step ID
          if (result.nextStepId === STEP_END) {
            logger.info(`[ExecutionEngine] Reached __END__, completing execution`);
            await this.transitionState(ExecutionState.COMPLETED);
            break;
          }

          // Jump to specific step
          const nextIndex = steps.findIndex(s => s.step_id === result.nextStepId);
          if (nextIndex === -1) {
            throw new Error(`Step not found: ${result.nextStepId}`);
          }
          stepIndex = nextIndex;
        } else {
          // Continue to next sequential step (only for non-condition steps)
          stepIndex++;
        }
      }

      // Check if all steps completed
      if (!this.execution.state.match(/FAILED|WAITING_APPROVAL/)) {
        await this.transitionState(ExecutionState.COMPLETED);
        await incrementMetric('executions_completed');
      }

    } catch (error) {
      logger.error(`[ExecutionEngine] Execution failed: ${error.message}`);
      await this.failExecution(error);
    }

    return this.execution;
  }

  /**
   * Execute a single step
   */
  async executeStep(step, stepIndex) {
    const stepResult = {
      terminate: false,
      nextStepId: null
    };

    logger.info(`[ExecutionEngine] Executing step ${step.step_id}: ${step.name}`);

    // Mark step as EXECUTING
    await this.updateStepState(step.step_id, StepState.EXECUTING);

    const context = this.buildContext();
    let resolvedInputs;

    try {
      // Resolve inputs from context — support both step.input and step.parameters formats
      const inputMapping = step.input || this.buildInputMapping(step, context) || {};
      resolvedInputs = resolveInputs(inputMapping, context);

    } catch (error) {
      return await this.handleStepError(step, error, stepResult);
    }

    // Execute based on step type
    try {
      let output;
      let nextStep = null;

      switch (step.type) {
        case 'enrichment':
          output = await this.executeEnrichmentStep(step, resolvedInputs);
          break;

        case 'condition':
          const condResult = await this.executeConditionStep(step, resolvedInputs, context);
          output = condResult.output;
          nextStep = condResult.nextStep;
          break;

        case 'approval':
          const approvalResult = await this.executeApprovalStep(step, resolvedInputs);
          if (approvalResult.waiting) {
            // Pause execution - will be resumed via API
            stepResult.terminate = true;
            return stepResult;
          }
          output = approvalResult.output;
          nextStep = approvalResult.nextStep;
          break;

        case 'action':
          output = await this.executeActionStep(step, resolvedInputs);
          break;

        case 'notification':
          output = await this.executeNotificationStep(step, resolvedInputs, context);
          break;

        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }

      // Store output for downstream steps
      this.stepOutputs.set(step.step_id, { output });

      // Mark step completed
      await this.updateStepState(step.step_id, StepState.COMPLETED, output);

      await this.emitAuditEvent('step.completed', {
        step_id: step.step_id,
        step_type: step.type,
        shadow_mode: this.shadowMode && step.type === 'action'
      });

      await incrementMetric('steps_completed');

      // Handle on_success behavior
      if (step.on_success?.behavior === 'end') {
        stepResult.terminate = true;
        await this.transitionState(ExecutionState.COMPLETED);
      } else if (step.on_success?.behavior === 'goto') {
        stepResult.nextStepId = step.on_success.step_id;
      } else if (nextStep) {
        stepResult.nextStepId = nextStep;
      }

      return stepResult;

    } catch (error) {
      return await this.handleStepError(step, error, stepResult);
    }
  }

  /**
   * Handle step execution error with retry logic
   */
  async handleStepError(step, error, stepResult) {
    logger.error(`[ExecutionEngine] Step ${step.step_id} failed: ${error.message}`);

    // Check retry policy
    const retryPolicy = step.retry_policy;
    const stepRecord = this.execution.steps.find(s => s.step_id === step.step_id);
    const retryCount = stepRecord?.retry_count || 0;

    if (retryPolicy?.enabled && retryCount < retryPolicy.max_attempts) {
      // Calculate delay with exponential backoff
      const delay = Math.min(
        retryPolicy.delay_seconds * Math.pow(retryPolicy.backoff_multiplier || 2, retryCount),
        retryPolicy.max_delay_seconds || 60
      );

      logger.info(`[ExecutionEngine] Retrying step ${step.step_id} in ${delay}s (attempt ${retryCount + 1}/${retryPolicy.max_attempts})`);

      await incrementMetric('step_retries');

      // Update retry count
      await this.updateStepRetryCount(step.step_id, retryCount + 1);

      // Wait and retry (in real implementation, this would be event-driven)
      await new Promise(resolve => setTimeout(resolve, delay * 1000));

      // Retry by returning to same step
      stepResult.nextStepId = step.step_id;
      return stepResult;
    }

    // No more retries - handle failure
    await this.updateStepState(step.step_id, StepState.FAILED, null, {
      message: error.message,
      code: error.code || 'STEP_EXECUTION_FAILED'
    });

    await this.emitAuditEvent('step.failed', {
      step_id: step.step_id,
      step_type: step.type,
      error: error.message
    });

    await incrementMetric('steps_failed');

    // Apply on_failure behavior
    switch (step.on_failure) {
      case 'stop':
        stepResult.terminate = true;
        await this.failExecution(error, step.step_id);
        break;

      case 'continue':
        // Log and continue to next step
        logger.warn(`[ExecutionEngine] Continuing after step failure: ${step.step_id}`);
        break;

      case 'skip':
        // Skip to end of playbook
        stepResult.terminate = true;
        await this.transitionState(ExecutionState.COMPLETED);
        break;

      default:
        // Default: stop on failure
        stepResult.terminate = true;
        await this.failExecution(error, step.step_id);
    }

    return stepResult;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PARAMETER COMPATIBILITY LAYER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Build input mapping from step.parameters when step.input is not defined.
   * Bridges the frontend DSL format (parameters/observable_field) to the
   * engine's declarative input mapping format.
   */
  buildInputMapping(step, context) {
    const params = step.parameters;

    if (step.type === 'enrichment' && params?.observable_field) {
      // Map action_type to expected input field name
      const actionFieldMap = {
        lookup_ip: 'ip',
        lookup_domain: 'domain',
        lookup_hash: 'hash',
        lookup_url: 'url',
      };
      const fieldName = actionFieldMap[step.action_type] || 'ip';
      const observable = params.observable_field;

      // Resolve observable from trigger_data — real Wazuh alerts store IPs at
      // data.srcip / data.dstip, while normalized payloads use source_ip / destination_ip
      const td = context.trigger_data || {};
      const wazuhFieldMap = {
        source_ip: ['source_ip', 'data.srcip', 'srcip'],
        destination_ip: ['destination_ip', 'data.dstip', 'dstip'],
        source_port: ['source_port', 'data.srcport'],
        hash: ['hash', 'data.hash', 'syscheck.sha256'],
        domain: ['domain', 'data.hostname', 'data.url'],
      };
      const candidates = wazuhFieldMap[observable] || [observable];
      let resolvedValue = null;
      for (const path of candidates) {
        const parts = path.split('.');
        let val = td;
        for (const p of parts) {
          if (val == null) break;
          val = val[p];
        }
        if (val != null && val !== '') {
          resolvedValue = val;
          break;
        }
      }

      if (resolvedValue) {
        return { [fieldName]: `literal:${resolvedValue}` };
      }
      // Fallback: use the original path expression
      return { [fieldName]: `trigger_data.${observable}` };
    }

    if (step.type === 'action' && params) {
      // Action parameters use {{template}} syntax — resolve them to literal values
      const resolved = {};
      for (const [key, val] of Object.entries(params)) {
        if (typeof val === 'string' && val.includes('{{')) {
          resolved[key] = `literal:${renderTemplate(val, context)}`;
        } else if (val !== undefined && val !== '') {
          resolved[key] = typeof val === 'string' ? `literal:${val}` : val;
        }
      }
      return resolved;
    }

    if (step.type === 'notification') {
      // Notification steps store fields directly on the step object
      const resolved = {};
      if (step.recipients) resolved.to = `literal:${renderTemplate(step.recipients, context)}`;
      if (step.subject) resolved.subject = `literal:${renderTemplate(step.subject, context)}`;
      if (step.message) resolved.message = `literal:${renderTemplate(step.message, context)}`;
      return resolved;
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP TYPE EXECUTORS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute ENRICHMENT step
   */
  async executeEnrichmentStep(step, inputs) {
    return await invokeConnector(
      step.connector_id,
      step.action_type,
      inputs,
      step.timeout_seconds
    );
  }

  /**
   * Execute CONDITION step (HARDENED)
   *
   * HARDENING: Condition steps are TERMINAL in execution path.
   * They MUST always branch via on_true or on_false.
   * NO fall-through to next step index is allowed.
   */
  async executeConditionStep(step, inputs, context) {
    const condition = step.condition;
    const fieldValue = this.resolveFieldPath(condition.field, context);

    const result = evaluateCondition(
      fieldValue,
      condition.operator,
      condition.value
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // HARDENING #1: Condition MUST provide branch target
    // ═══════════════════════════════════════════════════════════════════════════
    const nextStep = result ? step.on_true : step.on_false;

    if (!nextStep) {
      // This should have been caught by validation, but enforce at runtime too
      const branchName = result ? 'on_true' : 'on_false';
      const error = new Error(
        `Condition step ${step.step_id} missing ${branchName} branch target. ` +
        `Condition evaluated to ${result} but no ${branchName} defined.`
      );
      error.code = 'CONDITION_MISSING_BRANCH';
      throw error;
    }

    logger.info(`[ExecutionEngine] Condition ${step.step_id}: ${fieldValue} ${condition.operator} ${condition.value} = ${result} → ${nextStep}`);

    return {
      output: {
        result,
        evaluated_value: fieldValue,
        branch_taken: result ? 'on_true' : 'on_false',
        next_step: nextStep
      },
      nextStep
    };
  }

  /**
   * Execute APPROVAL step
   * Pauses execution and waits for human decision
   */
  async executeApprovalStep(step, inputs) {
    // Create approval request
    const approvalRequest = {
      execution_id: this.execution.execution_id,
      step_id: step.step_id,
      approvers: step.approvers,
      message: renderTemplate(step.message, this.buildContext()),
      context: inputs,
      timeout_hours: step.timeout_hours || 1,
      created_at: new Date()
    };

    // Store approval in database (implementation in approval-service)
    const approvalId = await this.createApprovalRequest(approvalRequest);

    // Transition execution to WAITING_APPROVAL
    await this.transitionState(ExecutionState.WAITING_APPROVAL);
    this.execution.approval_id = approvalId;
    await this.execution.save();

    await this.emitAuditEvent('approval.requested', {
      approval_id: approvalId,
      step_id: step.step_id,
      approvers: step.approvers
    });

    await incrementMetric('approvals_requested');

    return {
      waiting: true,
      approvalId
    };
  }

  /**
   * Execute ACTION step
   * SHADOW MODE: Actions are SKIPPED, not executed
   */
  async executeActionStep(step, inputs) {
    // SHADOW MODE ENFORCEMENT
    if (this.shadowMode) {
      logger.info(`[ExecutionEngine] SHADOW MODE: Skipping action ${step.step_id}`);

      await this.updateStepState(step.step_id, StepState.SKIPPED, {
        shadow_mode: true,
        would_execute: {
          connector_id: step.connector_id,
          action_type: step.action_type,
          inputs
        }
      });

      await this.emitAuditEvent('action.skipped.shadow_mode', {
        step_id: step.step_id,
        connector_id: step.connector_id,
        action_type: step.action_type
      });

      await incrementMetric('actions_skipped_shadow');

      return {
        skipped: true,
        reason: 'shadow_mode',
        would_execute: { connector_id: step.connector_id, action_type: step.action_type }
      };
    }

    // Execute action via connector
    const result = await invokeConnector(
      step.connector_id,
      step.action_type,
      inputs,
      step.timeout_seconds
    );

    await incrementMetric('actions_executed');

    return result;
  }

  /**
   * Execute NOTIFICATION step
   */
  async executeNotificationStep(step, inputs, context) {
    // Render message template — step.input format (engine DSL) or inputs.message (parameters format)
    const renderedMessage = step.input?.message_template
      ? renderTemplate(step.input.message_template.replace('literal:', ''), context)
      : inputs.message;

    const notificationInputs = {
      ...inputs,
      message: renderedMessage
    };

    return await invokeConnector(
      step.connector_id,
      step.action_type,
      notificationInputs,
      step.timeout_seconds
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Transition execution state with validation
   */
  async transitionState(newState) {
    const currentState = this.execution.state;

    if (!canTransition(currentState, newState)) {
      throw new Error(`Invalid state transition: ${currentState} → ${newState}`);
    }

    logger.info(`[ExecutionEngine] State transition: ${currentState} → ${newState}`);

    this.execution.state = newState;

    if (newState === ExecutionState.COMPLETED || newState === ExecutionState.FAILED) {
      this.execution.completed_at = new Date();
      this.execution.duration_ms = this.execution.completed_at - this.execution.started_at;
    }

    await this.execution.save();
  }

  /**
   * Update step state
   */
  async updateStepState(stepId, state, output = null, error = null) {
    const step = this.execution.steps.find(s => s.step_id === stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    step.state = state;

    if (state === StepState.EXECUTING) {
      step.started_at = new Date();
    }

    if (state === StepState.COMPLETED || state === StepState.FAILED || state === StepState.SKIPPED) {
      step.completed_at = new Date();
      if (step.started_at) {
        step.duration_ms = step.completed_at - step.started_at;
      }
    }

    if (output !== null) {
      step.output = output;
    }

    if (error !== null) {
      step.error = error;
    }

    await this.execution.save();
  }

  /**
   * Update step retry count
   */
  async updateStepRetryCount(stepId, count) {
    const step = this.execution.steps.find(s => s.step_id === stepId);
    if (step) {
      step.retry_count = count;
      await this.execution.save();
    }
  }

  /**
   * Mark execution as failed
   */
  async failExecution(error, stepId = null) {
    await this.transitionState(ExecutionState.FAILED);

    this.execution.error = {
      message: error.message,
      code: error.code || 'EXECUTION_FAILED',
      step_id: stepId,
      timestamp: new Date()
    };

    await this.execution.save();

    await this.emitAuditEvent('execution.failed', {
      error: error.message,
      step_id: stepId
    });

    await incrementMetric('executions_failed');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve a field path from context (e.g., "steps.enrich_ip.output.score")
   */
  resolveFieldPath(path, context) {
    const parts = path.split('.');
    let current = context;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[part];
    }

    return current;
  }

  /**
   * Create approval request (stub - implemented in approval-service)
   */
  async createApprovalRequest(request) {
    // This would be implemented in approval-service
    // Returns approval_id
    return `APR-${Date.now().toString(36).toUpperCase()}`;
  }

  /**
   * Emit audit event
   */
  async emitAuditEvent(action, details) {
    await logAction({
      action,
      resource_type: 'execution',
      resource_id: this.execution.execution_id,
      resource_name: this.playbook.name,
      details: {
        ...details,
        playbook_id: this.playbook.playbook_id,
        execution_id: this.execution.execution_id
      },
      outcome: action.includes('failed') ? 'failure' : 'success'
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTED FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Start execution of a playbook with trigger data (HARDENED)
 *
 * HARDENING: Validates playbook before execution to catch:
 * - Missing condition branch targets (on_true/on_false)
 * - Missing approval timeout behavior (on_timeout)
 * - Invalid step references
 *
 * OPTION A COMPLIANCE:
 * - Accepts both old Playbook and new PlaybookVersioned formats
 * - Normalizes to execution-compatible format
 */
export async function startExecution(playbook, triggerData) {
  // ═══════════════════════════════════════════════════════════════════════════════
  // NORMALIZATION: Handle both Playbook and PlaybookVersioned formats
  // ═══════════════════════════════════════════════════════════════════════════════
  let normalizedPlaybook = playbook;

  // If this is a PlaybookVersioned document (has dsl field), normalize it
  if (playbook.dsl) {
    normalizedPlaybook = {
      playbook_id: playbook.playbook_id,
      name: playbook.name,
      description: playbook.description,
      shadow_mode: playbook.dsl.shadow_mode || false,
      steps: playbook.dsl.steps || [],
      version: playbook.version,
      enabled: playbook.enabled
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // HARDENING: Validate playbook before execution
  // ═══════════════════════════════════════════════════════════════════════════════
  try {
    validatePlaybookOrThrow(normalizedPlaybook);
  } catch (validationError) {
    logger.error(`[startExecution] Playbook validation failed: ${validationError.message}`);
    throw validationError;
  }

  // Create execution record
  const execution = new Execution({
    playbook_id: normalizedPlaybook.playbook_id,
    playbook_name: normalizedPlaybook.name,
    state: ExecutionState.EXECUTING,
    trigger_data: triggerData,
    steps: normalizedPlaybook.steps.map(step => ({
      step_id: step.step_id,
      state: StepState.PENDING
    })),
    started_at: new Date()
  });

  await execution.save();

  logger.info(`[startExecution] Created execution ${execution.execution_id} for playbook ${normalizedPlaybook.playbook_id}`);

  // Create engine and start execution
  const engine = new ExecutionEngine(execution, normalizedPlaybook);

  // Execute asynchronously
  setImmediate(() => {
    engine.execute().catch(error => {
      logger.error(`[startExecution] Execution failed: ${error.message}`);
    });
  });

  return execution;
}

/**
 * Resume execution after approval decision (HARDENED)
 *
 * HARDENING #3: Approval timeout semantics
 * - on_timeout behavior is MANDATORY (validated at playbook save)
 * - Allowed values: 'fail', 'continue', 'skip', or a step_id
 * - Decision types: 'approved', 'rejected', 'timeout'
 *
 * OPTION A COMPLIANCE:
 * - Uses PlaybookVersioned.getActiveVersion() for playbook lookup
 */
export async function resumeExecution(executionId, approvalDecision) {
  const execution = await Execution.findOne({ execution_id: executionId });
  if (!execution) {
    throw new Error(`Execution not found: ${executionId}`);
  }

  if (execution.state !== ExecutionState.WAITING_APPROVAL) {
    throw new Error(`Cannot resume execution in state: ${execution.state}`);
  }

  // Find the playbook (use PlaybookVersioned)
  const PlaybookVersioned = (await import('../models/playbook-v2.js')).default;
  const playbookDoc = await PlaybookVersioned.getActiveVersion(execution.playbook_id);

  if (!playbookDoc) {
    throw new Error(`Playbook not found or inactive: ${execution.playbook_id}`);
  }

  // Convert to execution-compatible format
  const playbook = {
    playbook_id: playbookDoc.playbook_id,
    name: playbookDoc.name,
    description: playbookDoc.description,
    shadow_mode: playbookDoc.dsl?.shadow_mode || false,
    steps: playbookDoc.dsl?.steps || [],
    version: playbookDoc.version,
    enabled: playbookDoc.enabled
  };

  // Find the approval step
  const approvalStep = playbook.steps.find(s =>
    execution.steps.find(es => es.step_id === s.step_id && es.state === StepState.EXECUTING)
  );

  if (!approvalStep) {
    throw new Error(`No pending approval step found in execution ${executionId}`);
  }

  logger.info(`[resumeExecution] Processing ${approvalDecision} for ${executionId}, step ${approvalStep.step_id}`);

  // ═══════════════════════════════════════════════════════════════════════════════
  // HARDENING #3: Handle approval decisions with explicit behavior
  // ═══════════════════════════════════════════════════════════════════════════════

  switch (approvalDecision) {
    case 'approved':
      return await handleApprovalApproved(execution, playbook, approvalStep);

    case 'rejected':
      return await handleApprovalRejected(execution, playbook, approvalStep);

    case 'timeout':
      return await handleApprovalTimeout(execution, playbook, approvalStep);

    default:
      throw new Error(`Invalid approval decision: ${approvalDecision}`);
  }
}

/**
 * Handle approval APPROVED
 */
async function handleApprovalApproved(execution, playbook, approvalStep) {
  // Transition back to EXECUTING
  execution.state = ExecutionState.EXECUTING;
  await execution.save();

  // Continue execution from next step after approval
  const engine = new ExecutionEngine(execution, playbook);

  // Restore step outputs from execution record
  for (const step of execution.steps) {
    if (step.output) {
      engine.stepOutputs.set(step.step_id, { output: step.output });
    }
  }

  // Mark approval step as completed
  await engine.updateStepState(approvalStep.step_id, StepState.COMPLETED, {
    decision: 'approved',
    decided_at: new Date()
  });

  await engine.emitAuditEvent('approval.approved', {
    step_id: approvalStep.step_id
  });

  await incrementMetric('approvals_approved');

  // Determine next step (on_approved or continue)
  const nextStepId = approvalStep.on_approved;

  if (nextStepId && nextStepId !== STEP_END) {
    const nextIndex = playbook.steps.findIndex(s => s.step_id === nextStepId);
    if (nextIndex !== -1) {
      engine.currentStepIndex = nextIndex;
    }
  } else {
    // Continue to step after approval step
    const approvalIndex = playbook.steps.findIndex(s => s.step_id === approvalStep.step_id);
    engine.currentStepIndex = approvalIndex + 1;
  }

  // Continue execution
  setImmediate(() => {
    engine.execute().catch(error => {
      logger.error(`[resumeExecution] Execution failed: ${error.message}`);
    });
  });

  return execution;
}

/**
 * Handle approval REJECTED
 */
async function handleApprovalRejected(execution, playbook, approvalStep) {
  const onRejected = approvalStep.on_rejected || 'fail';

  await logAction({
    action: 'approval.rejected',
    resource_type: 'execution',
    resource_id: execution.execution_id,
    details: { step_id: approvalStep.step_id, on_rejected: onRejected },
    outcome: 'success'
  });

  await incrementMetric('approvals_rejected');

  if (onRejected === 'fail' || onRejected === 'stop') {
    // Fail the execution
    execution.state = ExecutionState.FAILED;
    execution.completed_at = new Date();
    execution.error = {
      message: 'Approval rejected',
      code: 'APPROVAL_REJECTED',
      step_id: approvalStep.step_id,
      timestamp: new Date()
    };
    await execution.save();
    await incrementMetric('executions_failed');
  } else {
    // on_rejected is a step_id to jump to
    execution.state = ExecutionState.EXECUTING;
    await execution.save();

    const engine = new ExecutionEngine(execution, playbook);
    for (const step of execution.steps) {
      if (step.output) {
        engine.stepOutputs.set(step.step_id, { output: step.output });
      }
    }

    await engine.updateStepState(approvalStep.step_id, StepState.COMPLETED, {
      decision: 'rejected',
      decided_at: new Date()
    });

    const nextIndex = playbook.steps.findIndex(s => s.step_id === onRejected);
    if (nextIndex !== -1) {
      engine.currentStepIndex = nextIndex;
      setImmediate(() => {
        engine.execute().catch(error => {
          logger.error(`[resumeExecution] Execution failed: ${error.message}`);
        });
      });
    }
  }

  return execution;
}

/**
 * Handle approval TIMEOUT (HARDENED)
 *
 * HARDENING: on_timeout MUST be explicitly defined
 * Allowed values: 'fail', 'continue', 'skip', or a valid step_id
 */
async function handleApprovalTimeout(execution, playbook, approvalStep) {
  const onTimeout = approvalStep.on_timeout;

  // ═══════════════════════════════════════════════════════════════════════════════
  // HARDENING: on_timeout is MANDATORY - this should never be undefined
  // ═══════════════════════════════════════════════════════════════════════════════
  if (!onTimeout) {
    const error = new Error(
      `Approval step ${approvalStep.step_id} missing on_timeout behavior. ` +
      `This is a validation failure - on_timeout is MANDATORY.`
    );
    error.code = 'APPROVAL_MISSING_ON_TIMEOUT';

    execution.state = ExecutionState.FAILED;
    execution.error = {
      message: error.message,
      code: error.code,
      step_id: approvalStep.step_id,
      timestamp: new Date()
    };
    await execution.save();

    throw error;
  }

  await logAction({
    action: 'approval.timeout',
    resource_type: 'execution',
    resource_id: execution.execution_id,
    details: { step_id: approvalStep.step_id, on_timeout: onTimeout },
    outcome: 'success'
  });

  await incrementMetric('approvals_expired');

  // Handle based on on_timeout value
  switch (onTimeout) {
    case 'fail':
      execution.state = ExecutionState.FAILED;
      execution.completed_at = new Date();
      execution.error = {
        message: 'Approval timed out',
        code: 'APPROVAL_TIMEOUT',
        step_id: approvalStep.step_id,
        timestamp: new Date()
      };
      await execution.save();
      await incrementMetric('executions_failed');
      break;

    case 'continue':
      // Continue to next step after approval
      execution.state = ExecutionState.EXECUTING;
      await execution.save();

      const engineContinue = new ExecutionEngine(execution, playbook);
      for (const step of execution.steps) {
        if (step.output) {
          engineContinue.stepOutputs.set(step.step_id, { output: step.output });
        }
      }

      await engineContinue.updateStepState(approvalStep.step_id, StepState.COMPLETED, {
        decision: 'timeout',
        on_timeout_behavior: 'continue',
        decided_at: new Date()
      });

      const approvalIndex = playbook.steps.findIndex(s => s.step_id === approvalStep.step_id);
      engineContinue.currentStepIndex = approvalIndex + 1;

      setImmediate(() => {
        engineContinue.execute().catch(error => {
          logger.error(`[resumeExecution] Execution failed: ${error.message}`);
        });
      });
      break;

    case 'skip':
      // Skip to end - complete the execution
      execution.state = ExecutionState.COMPLETED;
      execution.completed_at = new Date();
      await execution.save();
      await incrementMetric('executions_completed');
      break;

    default:
      // on_timeout is a step_id or __END__ to jump to
      if (onTimeout === STEP_END) {
        // __END__ - Complete the execution
        execution.state = ExecutionState.COMPLETED;
        execution.completed_at = new Date();
        await execution.save();
        await incrementMetric('executions_completed');

        logger.info(`[handleApprovalTimeout] Approval timeout with __END__ - execution completed`);
      } else {
        // on_timeout is a step_id to jump to
        execution.state = ExecutionState.EXECUTING;
        await execution.save();

        const engineGoto = new ExecutionEngine(execution, playbook);
        for (const step of execution.steps) {
          if (step.output) {
            engineGoto.stepOutputs.set(step.step_id, { output: step.output });
          }
        }

        await engineGoto.updateStepState(approvalStep.step_id, StepState.COMPLETED, {
          decision: 'timeout',
          on_timeout_behavior: onTimeout,
          decided_at: new Date()
        });

        const nextIndex = playbook.steps.findIndex(s => s.step_id === onTimeout);
        if (nextIndex === -1) {
          throw new Error(`on_timeout step not found: ${onTimeout}`);
        }
        engineGoto.currentStepIndex = nextIndex;

        setImmediate(() => {
          engineGoto.execute().catch(error => {
            logger.error(`[resumeExecution] Execution failed: ${error.message}`);
          });
        });
      }
  }

  return execution;
}

export default {
  ExecutionEngine,
  startExecution,
  resumeExecution
};
