/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.0 — TRIGGER EVALUATION ENGINE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Evaluates incoming alerts against trigger conditions to determine
 * if a playbook should be executed.
 *
 * DESIGN PRINCIPLES:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. DECLARATIVE ONLY - No regex scripting, no inline JS
 * 2. FAIL SAFE - Evaluation errors drop the alert, never execute
 * 3. DETERMINISTIC - Same input always produces same output
 * 4. EFFICIENT - Short-circuit evaluation where possible
 *
 * SUPPORTED OPERATORS:
 * ─────────────────────────────────────────────────────────────────────────────
 * equals, not_equals, gt, gte, lt, lte
 * contains, not_contains, starts_with, ends_with
 * in, not_in, array_contains, array_contains_any
 * exists, not_exists
 *
 * VERSION: 1.0.0
 * AUTHOR: CyberSentinel SOAR Team
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { TriggerOperator, MatchMode } from '../models/trigger.js';
import logger from '../utils/logger.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TRIGGER EVALUATION RESULT
// ═══════════════════════════════════════════════════════════════════════════════

export class TriggerEvaluationResult {
  constructor() {
    this.matched = false;
    this.trigger_id = null;
    this.playbook_id = null;
    this.conditions_evaluated = 0;
    this.conditions_matched = 0;
    this.evaluation_ms = 0;
    this.decision = 'dropped';  // 'matched' or 'dropped'
    this.drop_reason = null;
    this.condition_results = [];  // Detailed results per condition
  }

  static match(trigger, conditionResults, evaluationMs) {
    const result = new TriggerEvaluationResult();
    result.matched = true;
    result.trigger_id = trigger.trigger_id;
    result.playbook_id = trigger.playbook_id;
    result.conditions_evaluated = conditionResults.length;
    result.conditions_matched = conditionResults.filter(c => c.matched).length;
    result.evaluation_ms = evaluationMs;
    result.decision = 'matched';
    result.condition_results = conditionResults;
    return result;
  }

  static drop(trigger, reason, conditionResults, evaluationMs) {
    const result = new TriggerEvaluationResult();
    result.matched = false;
    result.trigger_id = trigger?.trigger_id || null;
    result.playbook_id = trigger?.playbook_id || null;
    result.conditions_evaluated = conditionResults?.length || 0;
    result.conditions_matched = conditionResults?.filter(c => c.matched).length || 0;
    result.evaluation_ms = evaluationMs;
    result.decision = 'dropped';
    result.drop_reason = reason;
    result.condition_results = conditionResults || [];
    return result;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HARDENING: Field Path Resolution Result
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Result of field path resolution (HARDENED)
 * Distinguishes between:
 * - Field found with value (including null/false/0/empty string)
 * - Field not found (path partially exists but field doesn't)
 * - Path invalid (parent object doesn't exist)
 */
export class FieldResolutionResult {
  constructor(found, value, partialPath = false) {
    this.found = found;           // true if field exists
    this.value = value;           // actual value (may be null/undefined/0/false)
    this.partialPath = partialPath; // true if parent exists but field doesn't
  }

  static found(value) {
    return new FieldResolutionResult(true, value, false);
  }

  static notFound(partialPath = false) {
    return new FieldResolutionResult(false, undefined, partialPath);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIELD PATH RESOLVER (HARDENED)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve a field path from nested alert object (HARDENED)
 *
 * HARDENING RULES:
 * - If a field path PARTIALLY exists, returns notFound with partialPath=true
 * - No implicit truthy/falsey coercion
 * - Exact path resolution required
 *
 * Supports:
 * - Dot notation: "rule.id", "agent.name"
 * - Nested paths: "data.win.system.eventID"
 * - Array access: "rule.groups[0]"
 * - @ prefix fields: "@timestamp"
 *
 * @param {string} path - Field path (e.g., "rule.level")
 * @param {object} alert - Alert object to resolve from
 * @returns {FieldResolutionResult} - Resolution result with found/value/partialPath
 */
export function resolveFieldPath(path, alert) {
  if (!path || typeof path !== 'string') {
    return FieldResolutionResult.notFound(false);
  }

  if (!alert || typeof alert !== 'object') {
    return FieldResolutionResult.notFound(false);
  }

  try {
    const parts = path.split(/\.|\[|\]/).filter(p => p !== '');
    let current = alert;
    let parentExists = true;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      // Check if current is a valid object to traverse
      if (current === null || current === undefined) {
        return FieldResolutionResult.notFound(parentExists);
      }

      if (typeof current !== 'object') {
        // Can't traverse into non-object
        return FieldResolutionResult.notFound(parentExists);
      }

      // Handle numeric array index
      const key = /^\d+$/.test(part) ? parseInt(part, 10) : part;

      // HARDENING: Check if property actually exists (not inherited)
      const hasProperty = Array.isArray(current)
        ? key >= 0 && key < current.length
        : Object.prototype.hasOwnProperty.call(current, key);

      if (!hasProperty) {
        // Field doesn't exist - partialPath is true if we got here
        return FieldResolutionResult.notFound(i > 0);
      }

      current = current[key];
      parentExists = true;
    }

    // Successfully resolved
    return FieldResolutionResult.found(current);
  } catch (error) {
    logger.warn(`[TriggerEngine] Failed to resolve path '${path}': ${error.message}`);
    return FieldResolutionResult.notFound(false);
  }
}

/**
 * Legacy resolver for backward compatibility (returns raw value)
 * Use resolveFieldPath for hardened resolution
 */
export function resolveFieldPathLegacy(path, alert) {
  const result = resolveFieldPath(path, alert);
  return result.found ? result.value : undefined;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONDITION EVALUATORS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Evaluate a single condition against a field resolution result (HARDENED)
 *
 * HARDENING RULES:
 * - Uses STRICT equality (===) - no implicit type coercion
 * - Field not found → condition is FALSE (except for exists/not_exists)
 * - No truthy/falsey coercion
 *
 * @param {FieldResolutionResult} fieldResult - Resolution result from resolveFieldPath
 * @param {string} operator - Comparison operator
 * @param {*} conditionValue - Value to compare against
 * @returns {boolean} - Whether condition matches
 */
export function evaluateCondition(fieldResult, operator, conditionValue) {
  try {
    // ─────────────────────────────────────────────────────────────────────────
    // HARDENING: Handle field not found
    // ─────────────────────────────────────────────────────────────────────────

    // For exists/not_exists, we need to check field existence directly
    if (operator === TriggerOperator.EXISTS) {
      return fieldResult.found;
    }

    if (operator === TriggerOperator.NOT_EXISTS) {
      return !fieldResult.found;
    }

    // HARDENING: If field not found, condition FAILS (except exists operators)
    if (!fieldResult.found) {
      return false;
    }

    const fieldValue = fieldResult.value;

    switch (operator) {
      // ─────────────────────────────────────────────────────────────────────────
      // EQUALITY (STRICT - no type coercion)
      // ─────────────────────────────────────────────────────────────────────────

      case TriggerOperator.EQUALS:
        // HARDENING: Strict comparison - type must match
        if (typeof fieldValue === typeof conditionValue) {
          return fieldValue === conditionValue;
        }
        // Allow string-to-number comparison for common cases
        if (typeof fieldValue === 'string' && typeof conditionValue === 'number') {
          return fieldValue === String(conditionValue);
        }
        if (typeof fieldValue === 'number' && typeof conditionValue === 'string') {
          return String(fieldValue) === conditionValue;
        }
        return false;

      case TriggerOperator.NOT_EQUALS:
        if (typeof fieldValue === typeof conditionValue) {
          return fieldValue !== conditionValue;
        }
        if (typeof fieldValue === 'string' && typeof conditionValue === 'number') {
          return fieldValue !== String(conditionValue);
        }
        if (typeof fieldValue === 'number' && typeof conditionValue === 'string') {
          return String(fieldValue) !== conditionValue;
        }
        return true;  // Different types are not equal

      // ─────────────────────────────────────────────────────────────────────────
      // NUMERIC COMPARISON
      // ─────────────────────────────────────────────────────────────────────────

      case TriggerOperator.GREATER_THAN:
        if (typeof fieldValue !== 'number' || typeof conditionValue !== 'number') return false;
        return fieldValue > conditionValue;

      case TriggerOperator.GREATER_OR_EQUAL:
        if (typeof fieldValue !== 'number' || typeof conditionValue !== 'number') return false;
        return fieldValue >= conditionValue;

      case TriggerOperator.LESS_THAN:
        if (typeof fieldValue !== 'number' || typeof conditionValue !== 'number') return false;
        return fieldValue < conditionValue;

      case TriggerOperator.LESS_OR_EQUAL:
        if (typeof fieldValue !== 'number' || typeof conditionValue !== 'number') return false;
        return fieldValue <= conditionValue;

      // ─────────────────────────────────────────────────────────────────────────
      // STRING OPERATIONS
      // ─────────────────────────────────────────────────────────────────────────

      case TriggerOperator.CONTAINS:
        if (typeof fieldValue !== 'string') return false;
        if (typeof conditionValue !== 'string') return false;
        return fieldValue.toLowerCase().includes(conditionValue.toLowerCase());

      case TriggerOperator.NOT_CONTAINS:
        if (typeof fieldValue !== 'string') return false;
        if (typeof conditionValue !== 'string') return true;
        return !fieldValue.toLowerCase().includes(conditionValue.toLowerCase());

      case TriggerOperator.STARTS_WITH:
        if (typeof fieldValue !== 'string') return false;
        if (typeof conditionValue !== 'string') return false;
        return fieldValue.toLowerCase().startsWith(conditionValue.toLowerCase());

      case TriggerOperator.ENDS_WITH:
        if (typeof fieldValue !== 'string') return false;
        if (typeof conditionValue !== 'string') return false;
        return fieldValue.toLowerCase().endsWith(conditionValue.toLowerCase());

      // ─────────────────────────────────────────────────────────────────────────
      // ARRAY OPERATIONS (STRICT equality)
      // ─────────────────────────────────────────────────────────────────────────

      case TriggerOperator.IN:
        // Field value is IN the condition array
        if (!Array.isArray(conditionValue)) return false;
        return conditionValue.some(v => v === fieldValue);

      case TriggerOperator.NOT_IN:
        // Field value is NOT IN the condition array
        if (!Array.isArray(conditionValue)) return true;
        return !conditionValue.some(v => v === fieldValue);

      case TriggerOperator.ARRAY_CONTAINS:
        // Field is array and contains condition value
        if (!Array.isArray(fieldValue)) return false;
        return fieldValue.some(v => v === conditionValue);

      case TriggerOperator.ARRAY_CONTAINS_ANY:
        // Field is array and contains ANY of the condition values
        if (!Array.isArray(fieldValue) || !Array.isArray(conditionValue)) return false;
        return conditionValue.some(cv => fieldValue.some(fv => fv === cv));

      // ─────────────────────────────────────────────────────────────────────────
      // UNKNOWN OPERATOR
      // ─────────────────────────────────────────────────────────────────────────

      default:
        logger.warn(`[TriggerEngine] Unknown operator: ${operator}`);
        return false;
    }
  } catch (error) {
    logger.warn(`[TriggerEngine] Condition evaluation error: ${error.message}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN TRIGGER EVALUATOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Evaluate an alert against a trigger definition (HARDENED)
 *
 * HARDENING RULES:
 * - Conditions evaluated in declared order
 * - Short-circuit evaluation enforced
 * - Dot-path resolution is exact (partial path → condition fails)
 * - No implicit truthy/falsey coercion
 *
 * @param {object} trigger - Trigger document from database
 * @param {object} alert - Alert object to evaluate
 * @returns {TriggerEvaluationResult} - Evaluation result
 */
export function evaluateTrigger(trigger, alert) {
  const startTime = Date.now();
  const conditionResults = [];

  // Validate inputs
  if (!trigger) {
    return TriggerEvaluationResult.drop(null, 'TRIGGER_NULL', [], 0);
  }

  if (!alert || typeof alert !== 'object') {
    return TriggerEvaluationResult.drop(trigger, 'INVALID_PAYLOAD', [], Date.now() - startTime);
  }

  if (!trigger.enabled) {
    return TriggerEvaluationResult.drop(trigger, 'TRIGGER_DISABLED', [], Date.now() - startTime);
  }

  if (!trigger.conditions || trigger.conditions.length === 0) {
    return TriggerEvaluationResult.drop(trigger, 'NO_CONDITIONS', [], Date.now() - startTime);
  }

  const matchMode = trigger.match || MatchMode.ALL;

  // ═══════════════════════════════════════════════════════════════════════════
  // HARDENING: Evaluate each condition IN DECLARED ORDER
  // ═══════════════════════════════════════════════════════════════════════════
  for (let i = 0; i < trigger.conditions.length; i++) {
    const condition = trigger.conditions[i];

    // HARDENING: Use new field resolution that returns found/value/partialPath
    const fieldResult = resolveFieldPath(condition.field, alert);

    // HARDENING: Evaluate with strict comparison
    const matched = evaluateCondition(fieldResult, condition.operator, condition.value);

    conditionResults.push({
      field: condition.field,
      operator: condition.operator,
      expected: condition.value,
      actual: fieldResult.found ? fieldResult.value : undefined,
      field_found: fieldResult.found,
      partial_path: fieldResult.partialPath,
      matched
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // HARDENING: Short-circuit evaluation
    // ═══════════════════════════════════════════════════════════════════════════
    if (matchMode === MatchMode.ALL && !matched) {
      // ALL mode: First failure means no match
      return TriggerEvaluationResult.drop(
        trigger,
        'NO_TRIGGER_MATCH',
        conditionResults,
        Date.now() - startTime
      );
    }

    if (matchMode === MatchMode.ANY && matched) {
      // ANY mode: First success means match
      return TriggerEvaluationResult.match(trigger, conditionResults, Date.now() - startTime);
    }
  }

  // Final decision
  const evaluationMs = Date.now() - startTime;

  if (matchMode === MatchMode.ALL) {
    // ALL conditions passed
    return TriggerEvaluationResult.match(trigger, conditionResults, evaluationMs);
  } else {
    // ANY mode: No condition matched
    return TriggerEvaluationResult.drop(
      trigger,
      'NO_TRIGGER_MATCH',
      conditionResults,
      evaluationMs
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRIGGER VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate a trigger definition
 *
 * @param {object} trigger - Trigger definition to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateTriggerDefinition(trigger) {
  const errors = [];

  if (!trigger) {
    return { valid: false, errors: ['Trigger definition is required'] };
  }

  // Validate conditions
  if (!trigger.conditions || !Array.isArray(trigger.conditions)) {
    errors.push('conditions must be an array');
  } else if (trigger.conditions.length === 0) {
    errors.push('At least one condition is required');
  } else {
    trigger.conditions.forEach((cond, index) => {
      if (!cond.field) {
        errors.push(`conditions[${index}].field is required`);
      }
      if (!cond.operator) {
        errors.push(`conditions[${index}].operator is required`);
      } else if (!Object.values(TriggerOperator).includes(cond.operator)) {
        errors.push(`conditions[${index}].operator '${cond.operator}' is invalid`);
      }
      if (cond.value === undefined && !['exists', 'not_exists'].includes(cond.operator)) {
        errors.push(`conditions[${index}].value is required for operator '${cond.operator}'`);
      }
    });
  }

  // Validate match mode
  if (trigger.match && !Object.values(MatchMode).includes(trigger.match)) {
    errors.push(`match must be one of: ${Object.values(MatchMode).join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

export default {
  TriggerEvaluationResult,
  FieldResolutionResult,
  resolveFieldPath,
  resolveFieldPathLegacy,
  evaluateCondition,
  evaluateTrigger,
  validateTriggerDefinition
};
