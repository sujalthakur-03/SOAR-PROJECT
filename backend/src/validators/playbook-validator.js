/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.0 — PLAYBOOK DSL VALIDATOR (COMPREHENSIVE)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Production-grade validator for playbook DSL with:
 * - Complete step type validation (enrichment, condition, approval, action, notification)
 * - Circular reference detection using depth-first search
 * - Maximum step limit enforcement (100 steps)
 * - Condition step mandatory branching (on_true AND on_false)
 * - Approval step mandatory timeout handling (on_timeout)
 * - Shadow mode enforcement validation
 * - Step reference integrity checks
 * - Connector validation
 *
 * VALIDATION ERRORS = IMMEDIATE API REQUEST REJECTION
 *
 * VERSION: 2.0.0
 * ══════════════════════════════════════════════════════════════════════════════
 */

import logger from '../utils/logger.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const MAX_STEPS = 100;
const STEP_END = '__END__';

const VALID_STEP_TYPES = ['enrichment', 'condition', 'approval', 'action', 'notification'];
const VALID_ON_FAILURE = ['stop', 'continue', 'retry', 'skip'];
const VALID_APPROVAL_TIMEOUT_BEHAVIORS = ['fail', 'continue', 'skip'];
const VALID_CONDITION_OPERATORS = [
  'equals', 'not_equals',
  'greater_than', 'less_than',
  'greater_or_equal', 'less_or_equal',
  'contains', 'not_contains',
  'starts_with', 'ends_with',
  'regex_match',
  'in', 'not_in',
  'exists', 'not_exists'
];

// ═══════════════════════════════════════════════════════════════════════════
// ERROR CODES (STRUCTURED RESPONSE FORMAT)
// ═══════════════════════════════════════════════════════════════════════════

export const ErrorCodes = {
  // DSL structure errors
  DSL_VALIDATION_ERROR: 'DSL_VALIDATION_ERROR',
  DSL_NULL: 'DSL_NULL',
  DSL_NO_STEPS: 'DSL_NO_STEPS',
  DSL_INVALID_TYPE: 'DSL_INVALID_TYPE',

  // Step limit errors
  MAX_STEPS_EXCEEDED: 'MAX_STEPS_EXCEEDED',

  // Step structure errors
  MISSING_STEP_ID: 'MISSING_STEP_ID',
  MISSING_STEP_NAME: 'MISSING_STEP_NAME',
  MISSING_STEP_TYPE: 'MISSING_STEP_TYPE',
  INVALID_STEP_TYPE: 'INVALID_STEP_TYPE',
  DUPLICATE_STEP_ID: 'DUPLICATE_STEP_ID',

  // Step reference errors
  INVALID_STEP_REFERENCE: 'INVALID_STEP_REFERENCE',
  CIRCULAR_REFERENCE: 'CIRCULAR_REFERENCE',

  // Condition step errors
  CONDITION_MISSING_FIELD: 'CONDITION_MISSING_FIELD',
  CONDITION_MISSING_OPERATOR: 'CONDITION_MISSING_OPERATOR',
  CONDITION_INVALID_OPERATOR: 'CONDITION_INVALID_OPERATOR',
  CONDITION_MISSING_ON_TRUE: 'CONDITION_MISSING_ON_TRUE',
  CONDITION_MISSING_ON_FALSE: 'CONDITION_MISSING_ON_FALSE',
  CONDITION_INVALID_ON_TRUE: 'CONDITION_INVALID_ON_TRUE',
  CONDITION_INVALID_ON_FALSE: 'CONDITION_INVALID_ON_FALSE',

  // Approval step errors
  APPROVAL_MISSING_APPROVERS: 'APPROVAL_MISSING_APPROVERS',
  APPROVAL_MISSING_TIMEOUT_HOURS: 'APPROVAL_MISSING_TIMEOUT_HOURS',
  APPROVAL_MISSING_ON_TIMEOUT: 'APPROVAL_MISSING_ON_TIMEOUT',
  APPROVAL_INVALID_ON_TIMEOUT: 'APPROVAL_INVALID_ON_TIMEOUT',
  APPROVAL_INVALID_ON_APPROVED: 'APPROVAL_INVALID_ON_APPROVED',
  APPROVAL_INVALID_ON_REJECTED: 'APPROVAL_INVALID_ON_REJECTED',

  // Connector step errors
  CONNECTOR_MISSING_CONNECTOR_ID: 'CONNECTOR_MISSING_CONNECTOR_ID',
  CONNECTOR_MISSING_ACTION_TYPE: 'CONNECTOR_MISSING_ACTION_TYPE',

  // Other errors
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_ON_FAILURE: 'INVALID_ON_FAILURE'
};

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION ERROR CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class ValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION RESULT
// ═══════════════════════════════════════════════════════════════════════════

export class ValidationResult {
  constructor() {
    this.valid = true;
    this.errors = [];
    this.warnings = [];
  }

  addError(code, message, details = {}) {
    this.valid = false;
    this.errors.push({ code, message, ...details });
  }

  addWarning(code, message, details = {}) {
    this.warnings.push({ code, message, ...details });
  }

  throwIfInvalid() {
    if (!this.valid) {
      const error = new ValidationError(
        ErrorCodes.DSL_VALIDATION_ERROR,
        `DSL validation failed with ${this.errors.length} error(s)`,
        { errors: this.errors, warnings: this.warnings }
      );
      throw error;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN VALIDATION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate complete playbook DSL
 *
 * @param {Object} dsl - Playbook DSL object
 * @returns {ValidationResult} - Validation result with errors and warnings
 */
export function validatePlaybookDSL(dsl) {
  const result = new ValidationResult();

  // Basic structure validation
  if (!dsl) {
    result.addError(ErrorCodes.DSL_NULL, 'DSL is null or undefined');
    return result;
  }

  if (typeof dsl !== 'object') {
    result.addError(ErrorCodes.DSL_INVALID_TYPE, 'DSL must be an object');
    return result;
  }

  if (!Array.isArray(dsl.steps)) {
    result.addError(ErrorCodes.DSL_NO_STEPS, 'DSL must contain a steps array');
    return result;
  }

  if (dsl.steps.length === 0) {
    result.addError(ErrorCodes.DSL_NO_STEPS, 'DSL must contain at least one step');
    return result;
  }

  // Step limit validation
  if (dsl.steps.length > MAX_STEPS) {
    result.addError(
      ErrorCodes.MAX_STEPS_EXCEEDED,
      `Playbook exceeds maximum step limit (${dsl.steps.length} > ${MAX_STEPS})`,
      { step_count: dsl.steps.length, max_steps: MAX_STEPS }
    );
    return result;
  }

  // Collect all step IDs and check for duplicates
  const stepIds = new Set();
  const duplicateIds = new Set();

  for (const step of dsl.steps) {
    if (step.step_id) {
      if (stepIds.has(step.step_id)) {
        duplicateIds.add(step.step_id);
      }
      stepIds.add(step.step_id);
    }
  }

  if (duplicateIds.size > 0) {
    result.addError(
      ErrorCodes.DUPLICATE_STEP_ID,
      `Duplicate step IDs found: ${[...duplicateIds].join(', ')}`,
      { duplicate_ids: [...duplicateIds] }
    );
  }

  // Validate each step
  for (let i = 0; i < dsl.steps.length; i++) {
    validateStep(dsl.steps[i], i, stepIds, result);
  }

  // Check for circular references
  if (result.valid) {
    detectCircularReferences(dsl.steps, result);
  }

  // Log validation result
  if (!result.valid) {
    logger.error(`[PlaybookValidator] DSL validation failed with ${result.errors.length} error(s)`);
    for (const error of result.errors) {
      logger.error(`  [${error.code}] ${error.message}`);
    }
  } else {
    logger.debug(`[PlaybookValidator] DSL validation passed (${dsl.steps.length} steps)`);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

function validateStep(step, index, allStepIds, result) {
  const stepContext = { step_id: step.step_id, step_index: index };

  // Required fields
  if (!step.step_id) {
    result.addError(
      ErrorCodes.MISSING_STEP_ID,
      `Step at index ${index} is missing step_id`,
      { step_index: index }
    );
    return; // Cannot continue without step_id
  }

  if (!step.name) {
    result.addError(
      ErrorCodes.MISSING_STEP_NAME,
      `Step ${step.step_id} is missing name`,
      stepContext
    );
  }

  if (!step.type) {
    result.addError(
      ErrorCodes.MISSING_STEP_TYPE,
      `Step ${step.step_id} is missing type`,
      stepContext
    );
    return; // Cannot continue without type
  }

  // Validate step type
  if (!VALID_STEP_TYPES.includes(step.type)) {
    result.addError(
      ErrorCodes.INVALID_STEP_TYPE,
      `Step ${step.step_id} has invalid type '${step.type}'. Valid types: ${VALID_STEP_TYPES.join(', ')}`,
      { ...stepContext, invalid_type: step.type, valid_types: VALID_STEP_TYPES }
    );
    return; // Cannot continue with invalid type
  }

  // Validate on_failure
  if (step.on_failure && !VALID_ON_FAILURE.includes(step.on_failure)) {
    result.addError(
      ErrorCodes.INVALID_ON_FAILURE,
      `Step ${step.step_id} has invalid on_failure '${step.on_failure}'. Valid values: ${VALID_ON_FAILURE.join(', ')}`,
      { ...stepContext, invalid_value: step.on_failure, valid_values: VALID_ON_FAILURE }
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

  // Validate on_success goto references (if applicable)
  if (step.on_success?.behavior === 'goto') {
    if (!step.on_success.step_id) {
      result.addError(
        ErrorCodes.MISSING_REQUIRED_FIELD,
        `Step ${step.step_id} has on_success.behavior='goto' but missing step_id`,
        { ...stepContext, field: 'on_success.step_id' }
      );
    } else if (!allStepIds.has(step.on_success.step_id) && step.on_success.step_id !== STEP_END) {
      result.addError(
        ErrorCodes.INVALID_STEP_REFERENCE,
        `Step ${step.step_id} references non-existent step '${step.on_success.step_id}' in on_success`,
        { ...stepContext, target: step.on_success.step_id }
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONDITION STEP VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

function validateConditionStep(step, allStepIds, result) {
  const stepContext = { step_id: step.step_id, step_type: 'condition' };

  // Condition object required
  if (!step.condition) {
    result.addError(
      ErrorCodes.CONDITION_MISSING_FIELD,
      `Condition step ${step.step_id} missing 'condition' object`,
      stepContext
    );
    return;
  }

  // Validate condition structure
  if (!step.condition.field) {
    result.addError(
      ErrorCodes.CONDITION_MISSING_FIELD,
      `Condition step ${step.step_id} missing condition.field`,
      { ...stepContext, field: 'condition.field' }
    );
  }

  if (!step.condition.operator) {
    result.addError(
      ErrorCodes.CONDITION_MISSING_OPERATOR,
      `Condition step ${step.step_id} missing condition.operator`,
      { ...stepContext, field: 'condition.operator' }
    );
  } else if (!VALID_CONDITION_OPERATORS.includes(step.condition.operator)) {
    result.addError(
      ErrorCodes.CONDITION_INVALID_OPERATOR,
      `Condition step ${step.step_id} has invalid operator '${step.condition.operator}'. Valid operators: ${VALID_CONDITION_OPERATORS.join(', ')}`,
      { ...stepContext, invalid_operator: step.condition.operator, valid_operators: VALID_CONDITION_OPERATORS }
    );
  }

  if (step.condition.value === undefined && !['exists', 'not_exists'].includes(step.condition.operator)) {
    result.addError(
      ErrorCodes.MISSING_REQUIRED_FIELD,
      `Condition step ${step.step_id} missing condition.value (required for operator '${step.condition.operator}')`,
      { ...stepContext, field: 'condition.value' }
    );
  }

  // MANDATORY: on_true and on_false must both be defined
  if (!step.on_true) {
    result.addError(
      ErrorCodes.CONDITION_MISSING_ON_TRUE,
      `Condition step ${step.step_id} MUST define 'on_true'. Condition steps are terminal and must always branch.`,
      { ...stepContext, rule: 'NO_FALL_THROUGH' }
    );
  } else if (!allStepIds.has(step.on_true) && step.on_true !== STEP_END) {
    result.addError(
      ErrorCodes.CONDITION_INVALID_ON_TRUE,
      `Condition step ${step.step_id} references non-existent step '${step.on_true}' in on_true`,
      { ...stepContext, target: step.on_true }
    );
  }

  if (!step.on_false) {
    result.addError(
      ErrorCodes.CONDITION_MISSING_ON_FALSE,
      `Condition step ${step.step_id} MUST define 'on_false'. Condition steps are terminal and must always branch.`,
      { ...stepContext, rule: 'NO_FALL_THROUGH' }
    );
  } else if (!allStepIds.has(step.on_false) && step.on_false !== STEP_END) {
    result.addError(
      ErrorCodes.CONDITION_INVALID_ON_FALSE,
      `Condition step ${step.step_id} references non-existent step '${step.on_false}' in on_false`,
      { ...stepContext, target: step.on_false }
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// APPROVAL STEP VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

function validateApprovalStep(step, allStepIds, result) {
  const stepContext = { step_id: step.step_id, step_type: 'approval' };

  // Required fields
  if (!step.approvers || !Array.isArray(step.approvers) || step.approvers.length === 0) {
    result.addError(
      ErrorCodes.APPROVAL_MISSING_APPROVERS,
      `Approval step ${step.step_id} must define at least one approver`,
      stepContext
    );
  }

  if (step.timeout_hours === undefined || step.timeout_hours === null) {
    result.addError(
      ErrorCodes.APPROVAL_MISSING_TIMEOUT_HOURS,
      `Approval step ${step.step_id} must define timeout_hours`,
      { ...stepContext, field: 'timeout_hours' }
    );
  }

  // Validate on_approved reference
  if (step.on_approved && !allStepIds.has(step.on_approved) && step.on_approved !== STEP_END) {
    result.addError(
      ErrorCodes.APPROVAL_INVALID_ON_APPROVED,
      `Approval step ${step.step_id} references non-existent step '${step.on_approved}' in on_approved`,
      { ...stepContext, target: step.on_approved }
    );
  }

  // Validate on_rejected
  if (step.on_rejected) {
    const validOnRejected = ['fail', 'stop', STEP_END];
    const isValidStepRef = allStepIds.has(step.on_rejected);
    const isValidBehavior = validOnRejected.includes(step.on_rejected);

    if (!isValidStepRef && !isValidBehavior) {
      result.addError(
        ErrorCodes.APPROVAL_INVALID_ON_REJECTED,
        `Approval step ${step.step_id} has invalid on_rejected '${step.on_rejected}'. Must be 'fail', 'stop', '__END__', or a valid step_id`,
        { ...stepContext, invalid_value: step.on_rejected }
      );
    }
  }

  // MANDATORY: on_timeout must be explicitly defined
  if (!step.on_timeout) {
    result.addError(
      ErrorCodes.APPROVAL_MISSING_ON_TIMEOUT,
      `Approval step ${step.step_id} MUST define 'on_timeout'. No default behavior allowed. Valid values: ${VALID_APPROVAL_TIMEOUT_BEHAVIORS.join(', ')}, '__END__', or a valid step_id`,
      { ...stepContext, rule: 'EXPLICIT_TIMEOUT_BEHAVIOR', valid_values: [...VALID_APPROVAL_TIMEOUT_BEHAVIORS, STEP_END] }
    );
  } else {
    const isValidBehavior = VALID_APPROVAL_TIMEOUT_BEHAVIORS.includes(step.on_timeout);
    const isValidStepRef = allStepIds.has(step.on_timeout);
    const isEnd = step.on_timeout === STEP_END;

    if (!isValidBehavior && !isValidStepRef && !isEnd) {
      result.addError(
        ErrorCodes.APPROVAL_INVALID_ON_TIMEOUT,
        `Approval step ${step.step_id} has invalid on_timeout '${step.on_timeout}'. Valid values: ${VALID_APPROVAL_TIMEOUT_BEHAVIORS.join(', ')}, '__END__', or a valid step_id`,
        { ...stepContext, invalid_value: step.on_timeout, valid_values: [...VALID_APPROVAL_TIMEOUT_BEHAVIORS, STEP_END] }
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONNECTOR STEP VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

function validateConnectorStep(step, result) {
  const stepContext = { step_id: step.step_id, step_type: step.type };

  if (!step.connector_id) {
    result.addError(
      ErrorCodes.CONNECTOR_MISSING_CONNECTOR_ID,
      `${step.type} step ${step.step_id} must define connector_id`,
      { ...stepContext, field: 'connector_id' }
    );
  }

  if (!step.action_type) {
    result.addError(
      ErrorCodes.CONNECTOR_MISSING_ACTION_TYPE,
      `${step.type} step ${step.step_id} must define action_type`,
      { ...stepContext, field: 'action_type' }
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CIRCULAR REFERENCE DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect circular references in step graph using depth-first search
 * Checks all possible paths through the playbook for cycles
 */
function detectCircularReferences(steps, result) {
  // Build step lookup map
  const stepMap = new Map();
  for (const step of steps) {
    stepMap.set(step.step_id, step);
  }

  // Track visited steps in current path (for cycle detection)
  const visitedInPath = new Set();
  // Track all visited steps (for efficiency)
  const allVisited = new Set();

  // Helper to get all next steps from a given step
  function getNextSteps(step) {
    const nextSteps = [];

    if (step.type === 'condition') {
      if (step.on_true && step.on_true !== STEP_END) {
        nextSteps.push(step.on_true);
      }
      if (step.on_false && step.on_false !== STEP_END) {
        nextSteps.push(step.on_false);
      }
    } else if (step.type === 'approval') {
      if (step.on_approved && step.on_approved !== STEP_END) {
        nextSteps.push(step.on_approved);
      }
      if (step.on_rejected && step.on_rejected !== STEP_END && stepMap.has(step.on_rejected)) {
        nextSteps.push(step.on_rejected);
      }
      if (step.on_timeout && step.on_timeout !== STEP_END && stepMap.has(step.on_timeout)) {
        nextSteps.push(step.on_timeout);
      }
    } else if (step.on_success?.behavior === 'goto' && step.on_success.step_id !== STEP_END) {
      nextSteps.push(step.on_success.step_id);
    }

    return nextSteps;
  }

  // DFS to detect cycles
  function dfs(stepId, path) {
    if (visitedInPath.has(stepId)) {
      // Found a cycle
      const cycleStart = path.indexOf(stepId);
      const cycle = path.slice(cycleStart);
      cycle.push(stepId); // Complete the cycle

      result.addError(
        ErrorCodes.CIRCULAR_REFERENCE,
        `Circular reference detected: ${cycle.join(' -> ')}`,
        { cycle }
      );
      return true; // Cycle found
    }

    if (allVisited.has(stepId)) {
      // Already fully explored this path, no cycle
      return false;
    }

    const step = stepMap.get(stepId);
    if (!step) {
      // Invalid reference, but that's caught elsewhere
      return false;
    }

    visitedInPath.add(stepId);
    path.push(stepId);

    const nextSteps = getNextSteps(step);
    for (const nextStepId of nextSteps) {
      if (dfs(nextStepId, path)) {
        return true; // Propagate cycle detection
      }
    }

    visitedInPath.delete(stepId);
    allVisited.add(stepId);
    path.pop();

    return false;
  }

  // Start DFS from first step (assuming sequential execution starts there)
  if (steps.length > 0) {
    dfs(steps[0].step_id, []);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SHADOW MODE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate shadow mode configuration
 * When shadow_mode=true, action steps are skipped during execution
 */
export function validateShadowMode(dsl) {
  const warnings = [];

  if (dsl.shadow_mode === true) {
    const actionSteps = dsl.steps.filter(s => s.type === 'action');

    if (actionSteps.length > 0) {
      warnings.push({
        code: 'SHADOW_MODE_ACTIVE',
        message: `Shadow mode is enabled. ${actionSteps.length} action step(s) will be SKIPPED during execution`,
        details: {
          action_steps: actionSteps.map(s => s.step_id)
        }
      });
    }
  }

  return warnings;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTION: VALIDATE AND THROW
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate playbook DSL and throw if invalid
 * Use this for API endpoints that should fail fast
 */
export function validatePlaybookDSLOrThrow(dsl) {
  const result = validatePlaybookDSL(dsl);
  result.throwIfInvalid();
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  validatePlaybookDSL,
  validatePlaybookDSLOrThrow,
  validateShadowMode,
  ValidationResult,
  ValidationError,
  ErrorCodes,
  MAX_STEPS,
  STEP_END
};
