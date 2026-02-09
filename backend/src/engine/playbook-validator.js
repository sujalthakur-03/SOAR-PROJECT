/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.0 — PLAYBOOK VALIDATOR (HARDENED)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Strict validation rules for playbook definitions.
 * FAIL FAST on any violation - no silent acceptance.
 *
 * HARDENING RULES ENFORCED:
 * 1. Condition steps MUST define both on_true AND on_false (no fall-through)
 * 2. Approval steps MUST define on_timeout explicitly (no defaults)
 * 3. All step_id references must resolve to existing steps
 * 4. No duplicate step_ids
 * 5. Step types must be from canonical set
 *
 * VERSION: 1.1.0 (HARDENED)
 * AUTHOR: CyberSentinel SOAR Team
 * ══════════════════════════════════════════════════════════════════════════════
 */

import logger from '../utils/logger.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CANONICAL DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

const VALID_STEP_TYPES = ['enrichment', 'condition', 'approval', 'action', 'notification'];
const VALID_ON_FAILURE = ['stop', 'continue', 'retry', 'skip'];
const VALID_APPROVAL_TIMEOUT_BEHAVIORS = ['fail', 'continue', 'skip'];

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION RESULT
// ═══════════════════════════════════════════════════════════════════════════════

export class ValidationResult {
  constructor() {
    this.valid = true;
    this.errors = [];
    this.warnings = [];
  }

  addError(code, message, context = {}) {
    this.valid = false;
    this.errors.push({ code, message, ...context });
  }

  addWarning(code, message, context = {}) {
    this.warnings.push({ code, message, ...context });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN VALIDATOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate a playbook definition
 *
 * @param {object} playbook - Playbook definition to validate
 * @returns {ValidationResult} - Validation result with errors and warnings
 */
export function validatePlaybook(playbook) {
  const result = new ValidationResult();

  // Basic structure validation
  if (!playbook) {
    result.addError('PLAYBOOK_NULL', 'Playbook definition is null or undefined');
    return result;
  }

  if (!playbook.playbook_id) {
    result.addError('MISSING_PLAYBOOK_ID', 'Playbook must have a playbook_id');
  }

  if (!playbook.name) {
    result.addError('MISSING_PLAYBOOK_NAME', 'Playbook must have a name');
  }

  if (!Array.isArray(playbook.steps) || playbook.steps.length === 0) {
    result.addError('MISSING_STEPS', 'Playbook must have at least one step');
    return result;
  }

  // Collect all step_ids for reference validation
  const stepIds = new Set();
  const duplicateIds = new Set();

  for (const step of playbook.steps) {
    if (stepIds.has(step.step_id)) {
      duplicateIds.add(step.step_id);
    }
    stepIds.add(step.step_id);
  }

  if (duplicateIds.size > 0) {
    result.addError('DUPLICATE_STEP_IDS',
      `Duplicate step_ids found: ${[...duplicateIds].join(', ')}`,
      { duplicate_ids: [...duplicateIds] }
    );
  }

  // Validate each step
  for (let i = 0; i < playbook.steps.length; i++) {
    const step = playbook.steps[i];
    validateStep(step, i, stepIds, result);
  }

  // Log validation result
  if (!result.valid) {
    logger.error(`[PlaybookValidator] Playbook ${playbook.playbook_id || 'unknown'} failed validation with ${result.errors.length} error(s)`);
    for (const error of result.errors) {
      logger.error(`  [${error.code}] ${error.message}`);
    }
  }

  return result;
}

/**
 * Validate a single step
 */
function validateStep(step, index, allStepIds, result) {
  const stepContext = { step_id: step.step_id, step_index: index };

  // Basic step validation
  if (!step.step_id) {
    result.addError('MISSING_STEP_ID', `Step at index ${index} missing step_id`, stepContext);
    return;
  }

  if (!step.type) {
    result.addError('MISSING_STEP_TYPE', `Step ${step.step_id} missing type`, stepContext);
    return;
  }

  if (!VALID_STEP_TYPES.includes(step.type)) {
    result.addError('INVALID_STEP_TYPE',
      `Step ${step.step_id} has invalid type '${step.type}'. Valid types: ${VALID_STEP_TYPES.join(', ')}`,
      { ...stepContext, invalid_type: step.type }
    );
  }

  // Type-specific validation
  switch (step.type) {
    case 'condition':
      validateConditionStep(step, allStepIds, result);
      break;
    case 'approval':
      validateApprovalStep(step, allStepIds, result);
      break;
    case 'enrichment':
    case 'action':
    case 'notification':
      validateConnectorStep(step, result);
      break;
  }

  // Validate on_failure
  if (step.on_failure && !VALID_ON_FAILURE.includes(step.on_failure)) {
    result.addError('INVALID_ON_FAILURE',
      `Step ${step.step_id} has invalid on_failure '${step.on_failure}'. Valid values: ${VALID_ON_FAILURE.join(', ')}`,
      { step_id: step.step_id, invalid_value: step.on_failure }
    );
  }

  // Validate on_success goto references
  if (step.on_success?.behavior === 'goto') {
    if (!step.on_success.step_id) {
      result.addError('MISSING_GOTO_TARGET',
        `Step ${step.step_id} has on_success.behavior='goto' but missing step_id`,
        { step_id: step.step_id }
      );
    } else if (!allStepIds.has(step.on_success.step_id)) {
      result.addError('INVALID_GOTO_TARGET',
        `Step ${step.step_id} references non-existent step '${step.on_success.step_id}'`,
        { step_id: step.step_id, target: step.on_success.step_id }
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONDITION STEP VALIDATION (HARDENING #1)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate CONDITION step - MUST have both on_true and on_false
 *
 * HARDENING RULE:
 * - Condition steps are TERMINAL in execution path
 * - MUST always branch via on_true OR on_false
 * - NO implicit fall-through to next step index
 * - Validation FAILS if either is missing
 */
function validateConditionStep(step, allStepIds, result) {
  const stepContext = { step_id: step.step_id, step_type: 'condition' };

  // Condition object required
  if (!step.condition) {
    result.addError('CONDITION_MISSING_CONDITION',
      `Condition step ${step.step_id} missing 'condition' object`,
      stepContext
    );
  } else {
    if (!step.condition.field) {
      result.addError('CONDITION_MISSING_FIELD',
        `Condition step ${step.step_id} missing condition.field`,
        stepContext
      );
    }
    if (!step.condition.operator) {
      result.addError('CONDITION_MISSING_OPERATOR',
        `Condition step ${step.step_id} missing condition.operator`,
        stepContext
      );
    }
    if (step.condition.value === undefined) {
      result.addError('CONDITION_MISSING_VALUE',
        `Condition step ${step.step_id} missing condition.value`,
        stepContext
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HARDENING: on_true and on_false are MANDATORY (no fall-through)
  // ═══════════════════════════════════════════════════════════════════════════

  if (!step.on_true) {
    result.addError('CONDITION_MISSING_ON_TRUE',
      `Condition step ${step.step_id} MUST define 'on_true'. Condition steps are terminal and must always branch.`,
      { ...stepContext, rule: 'NO_FALL_THROUGH' }
    );
  } else if (!allStepIds.has(step.on_true) && step.on_true !== '__END__') {
    result.addError('CONDITION_INVALID_ON_TRUE',
      `Condition step ${step.step_id} references non-existent step '${step.on_true}' in on_true`,
      { ...stepContext, target: step.on_true }
    );
  }

  if (!step.on_false) {
    result.addError('CONDITION_MISSING_ON_FALSE',
      `Condition step ${step.step_id} MUST define 'on_false'. Condition steps are terminal and must always branch.`,
      { ...stepContext, rule: 'NO_FALL_THROUGH' }
    );
  } else if (!allStepIds.has(step.on_false) && step.on_false !== '__END__') {
    result.addError('CONDITION_INVALID_ON_FALSE',
      `Condition step ${step.step_id} references non-existent step '${step.on_false}' in on_false`,
      { ...stepContext, target: step.on_false }
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// APPROVAL STEP VALIDATION (HARDENING #3)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate APPROVAL step - MUST have on_timeout explicitly defined
 *
 * HARDENING RULE:
 * - on_timeout is MANDATORY (no default behavior)
 * - Allowed values: 'fail', 'continue', 'skip'
 * - Validation FAILS if missing or invalid
 */
function validateApprovalStep(step, allStepIds, result) {
  const stepContext = { step_id: step.step_id, step_type: 'approval' };

  // Basic approval requirements
  if (!step.approvers || !Array.isArray(step.approvers) || step.approvers.length === 0) {
    result.addError('APPROVAL_MISSING_APPROVERS',
      `Approval step ${step.step_id} must define at least one approver`,
      stepContext
    );
  }

  if (!step.timeout_hours && step.timeout_hours !== 0) {
    result.addError('APPROVAL_MISSING_TIMEOUT_HOURS',
      `Approval step ${step.step_id} must define timeout_hours`,
      stepContext
    );
  }

  // on_approved must reference valid step
  if (step.on_approved && !allStepIds.has(step.on_approved) && step.on_approved !== '__END__') {
    result.addError('APPROVAL_INVALID_ON_APPROVED',
      `Approval step ${step.step_id} references non-existent step '${step.on_approved}' in on_approved`,
      { ...stepContext, target: step.on_approved }
    );
  }

  // on_rejected must be valid
  if (step.on_rejected && !['fail', 'stop'].includes(step.on_rejected) && !allStepIds.has(step.on_rejected)) {
    result.addError('APPROVAL_INVALID_ON_REJECTED',
      `Approval step ${step.step_id} has invalid on_rejected '${step.on_rejected}'`,
      { ...stepContext, invalid_value: step.on_rejected }
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HARDENING: on_timeout is MANDATORY (no default behavior allowed)
  // ═══════════════════════════════════════════════════════════════════════════

  if (!step.on_timeout) {
    result.addError('APPROVAL_MISSING_ON_TIMEOUT',
      `Approval step ${step.step_id} MUST define 'on_timeout'. No default behavior allowed. Valid values: ${VALID_APPROVAL_TIMEOUT_BEHAVIORS.join(', ')}, '__END__', or a valid step_id`,
      { ...stepContext, rule: 'EXPLICIT_TIMEOUT_BEHAVIOR', valid_values: [...VALID_APPROVAL_TIMEOUT_BEHAVIORS, '__END__'] }
    );
  } else if (!VALID_APPROVAL_TIMEOUT_BEHAVIORS.includes(step.on_timeout) &&
             step.on_timeout !== '__END__' &&
             !allStepIds.has(step.on_timeout)) {
    result.addError('APPROVAL_INVALID_ON_TIMEOUT',
      `Approval step ${step.step_id} has invalid on_timeout '${step.on_timeout}'. Valid values: ${VALID_APPROVAL_TIMEOUT_BEHAVIORS.join(', ')}, '__END__', or a valid step_id`,
      { ...stepContext, invalid_value: step.on_timeout, valid_values: [...VALID_APPROVAL_TIMEOUT_BEHAVIORS, '__END__'] }
    );
  }
}

/**
 * Validate connector-based steps (enrichment, action, notification)
 */
function validateConnectorStep(step, result) {
  const stepContext = { step_id: step.step_id, step_type: step.type };

  if (!step.connector_id) {
    result.addError('CONNECTOR_MISSING_CONNECTOR_ID',
      `${step.type} step ${step.step_id} must define connector_id`,
      stepContext
    );
  }

  if (!step.action_type) {
    result.addError('CONNECTOR_MISSING_ACTION_TYPE',
      `${step.type} step ${step.step_id} must define action_type`,
      stepContext
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTED VALIDATION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate playbook and throw if invalid
 *
 * @param {object} playbook - Playbook to validate
 * @throws {Error} - If validation fails
 */
export function validatePlaybookOrThrow(playbook) {
  const result = validatePlaybook(playbook);

  if (!result.valid) {
    const error = new Error(`Playbook validation failed with ${result.errors.length} error(s)`);
    error.code = 'PLAYBOOK_VALIDATION_FAILED';
    error.errors = result.errors;
    throw error;
  }

  return result;
}

export default {
  validatePlaybook,
  validatePlaybookOrThrow,
  ValidationResult
};
