/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.0 — INPUT RESOLVER
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Resolves declarative input mappings to concrete values.
 * Evaluates conditions for branching logic.
 * Renders message templates.
 *
 * PURE DECLARATIVE - NO CODE EXECUTION
 *
 * VERSION: 1.0.0
 * AUTHOR: CyberSentinel SOAR Team
 * ══════════════════════════════════════════════════════════════════════════════
 */

import logger from '../utils/logger.js';

// ═══════════════════════════════════════════════════════════════════════════════
// INPUT RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve input mappings to concrete values
 *
 * Mapping format:
 * - "trigger_data.field.path"     → Value from trigger data
 * - "steps.step_id.output.field"  → Value from step output
 * - "playbook.field"              → Value from playbook config
 * - "literal:value"               → Literal value
 *
 * @param {object} inputMapping - Map of field name → path expression
 * @param {object} context - Execution context with trigger_data, steps, playbook
 * @returns {object} - Resolved input values
 */
export function resolveInputs(inputMapping, context) {
  const resolved = {};

  for (const [fieldName, pathExpression] of Object.entries(inputMapping)) {
    try {
      resolved[fieldName] = resolveValue(pathExpression, context);
    } catch (error) {
      logger.warn(`[resolveInputs] Failed to resolve ${fieldName}: ${error.message}`);
      resolved[fieldName] = undefined;
    }
  }

  return resolved;
}

/**
 * Resolve a single path expression to a value
 */
export function resolveValue(pathExpression, context) {
  if (pathExpression === null || pathExpression === undefined) {
    return undefined;
  }

  // Handle literal values
  if (typeof pathExpression === 'string' && pathExpression.startsWith('literal:')) {
    return parseLiteral(pathExpression.substring(8));
  }

  // Handle non-string values (already resolved)
  if (typeof pathExpression !== 'string') {
    return pathExpression;
  }

  // Resolve path from context
  return getNestedValue(context, pathExpression);
}

/**
 * Parse literal value
 */
function parseLiteral(value) {
  // Try to parse as number
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return parseFloat(value);
  }

  // Try to parse as boolean
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Try to parse as null
  if (value === 'null') return null;

  // Return as string
  return value;
}

/**
 * Get nested value from object using dot notation
 */
export function getNestedValue(obj, path) {
  if (!obj || !path) return undefined;

  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    // Handle array index notation (e.g., "items.0.name")
    if (/^\d+$/.test(part)) {
      current = Array.isArray(current) ? current[parseInt(part, 10)] : undefined;
    } else {
      current = current[part];
    }
  }

  return current;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONDITION EVALUATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Evaluate a condition
 *
 * DECLARATIVE OPERATORS ONLY - NO ARBITRARY EXPRESSIONS
 *
 * @param {*} fieldValue - The value to evaluate
 * @param {string} operator - Comparison operator
 * @param {*} compareValue - Value to compare against
 * @returns {boolean} - Condition result
 */
export function evaluateCondition(fieldValue, operator, compareValue) {
  switch (operator) {
    // Equality operators
    case 'equals':
    case '==':
    case 'eq':
      return fieldValue == compareValue;

    case 'not_equals':
    case '!=':
    case 'neq':
      return fieldValue != compareValue;

    case 'strict_equals':
    case '===':
      return fieldValue === compareValue;

    // Numeric comparison operators
    case 'greater_than':
    case '>':
    case 'gt':
      return toNumber(fieldValue) > toNumber(compareValue);

    case 'less_than':
    case '<':
    case 'lt':
      return toNumber(fieldValue) < toNumber(compareValue);

    case 'greater_or_equal':
    case '>=':
    case 'gte':
      return toNumber(fieldValue) >= toNumber(compareValue);

    case 'less_or_equal':
    case '<=':
    case 'lte':
      return toNumber(fieldValue) <= toNumber(compareValue);

    // String operators
    case 'contains':
      return toString(fieldValue).includes(toString(compareValue));

    case 'not_contains':
      return !toString(fieldValue).includes(toString(compareValue));

    case 'starts_with':
      return toString(fieldValue).startsWith(toString(compareValue));

    case 'ends_with':
      return toString(fieldValue).endsWith(toString(compareValue));

    case 'regex_match':
    case 'matches':
      try {
        const regex = new RegExp(compareValue);
        return regex.test(toString(fieldValue));
      } catch (error) {
        logger.warn(`[evaluateCondition] Invalid regex: ${compareValue}`);
        return false;
      }

    // Array operators
    case 'in':
      if (Array.isArray(compareValue)) {
        return compareValue.includes(fieldValue);
      }
      return toString(compareValue).split(',').map(s => s.trim()).includes(toString(fieldValue));

    case 'not_in':
      if (Array.isArray(compareValue)) {
        return !compareValue.includes(fieldValue);
      }
      return !toString(compareValue).split(',').map(s => s.trim()).includes(toString(fieldValue));

    // Existence operators
    case 'exists':
      return fieldValue !== undefined && fieldValue !== null;

    case 'not_exists':
      return fieldValue === undefined || fieldValue === null;

    case 'is_empty':
      return fieldValue === '' || fieldValue === null || fieldValue === undefined ||
             (Array.isArray(fieldValue) && fieldValue.length === 0) ||
             (typeof fieldValue === 'object' && Object.keys(fieldValue).length === 0);

    case 'is_not_empty':
      return !(fieldValue === '' || fieldValue === null || fieldValue === undefined ||
               (Array.isArray(fieldValue) && fieldValue.length === 0) ||
               (typeof fieldValue === 'object' && Object.keys(fieldValue).length === 0));

    // Type operators
    case 'is_type':
      return typeof fieldValue === compareValue;

    case 'is_array':
      return Array.isArray(fieldValue);

    case 'is_object':
      return typeof fieldValue === 'object' && fieldValue !== null && !Array.isArray(fieldValue);

    default:
      logger.warn(`[evaluateCondition] Unknown operator: ${operator}`);
      return false;
  }
}

/**
 * Convert value to number safely
 */
function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const num = parseFloat(value);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

/**
 * Convert value to string safely
 */
function toString(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return String(value);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE RENDERING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Render a message template with variable substitution
 *
 * Template format: "Hello {{trigger_data.agent.name}}, score is {{steps.enrich.output.score}}"
 *
 * @param {string} template - Template string with {{path}} placeholders
 * @param {object} context - Context for variable resolution
 * @returns {string} - Rendered string
 */
export function renderTemplate(template, context) {
  if (!template || typeof template !== 'string') {
    return template;
  }

  // Match {{path.to.value}} patterns
  const pattern = /\{\{([^}]+)\}\}/g;

  return template.replace(pattern, (match, path) => {
    const trimmedPath = path.trim();
    const value = getNestedValue(context, trimmedPath);

    if (value === undefined || value === null) {
      return match; // Keep original if not found
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPOUND CONDITIONS (AND/OR)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Evaluate compound condition with AND/OR logic
 *
 * @param {object} compoundCondition - { operator: 'and'|'or', conditions: [...] }
 * @param {object} context - Execution context
 * @returns {boolean} - Result
 */
export function evaluateCompoundCondition(compoundCondition, context) {
  const { operator, conditions } = compoundCondition;

  if (!Array.isArray(conditions)) {
    logger.warn('[evaluateCompoundCondition] conditions must be an array');
    return false;
  }

  const results = conditions.map(cond => {
    if (cond.operator === 'and' || cond.operator === 'or') {
      // Nested compound condition
      return evaluateCompoundCondition(cond, context);
    }

    // Simple condition
    const fieldValue = getNestedValue(context, cond.field);
    return evaluateCondition(fieldValue, cond.operator, cond.value);
  });

  if (operator === 'and') {
    return results.every(r => r === true);
  }

  if (operator === 'or') {
    return results.some(r => r === true);
  }

  logger.warn(`[evaluateCompoundCondition] Unknown operator: ${operator}`);
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OUTPUT MAPPING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Map connector output to step output using JSONPath-like expressions
 *
 * @param {object} rawOutput - Raw connector output
 * @param {object} outputMapping - Map of field name → JSONPath expression
 * @returns {object} - Mapped output
 */
export function mapOutput(rawOutput, outputMapping) {
  if (!outputMapping) {
    return rawOutput;
  }

  const mapped = {};

  for (const [fieldName, jsonPath] of Object.entries(outputMapping)) {
    try {
      mapped[fieldName] = resolveJsonPath(rawOutput, jsonPath);
    } catch (error) {
      logger.warn(`[mapOutput] Failed to resolve ${fieldName}: ${error.message}`);
      mapped[fieldName] = undefined;
    }
  }

  return mapped;
}

/**
 * Resolve simple JSONPath expression
 * Supports: $.field, $.nested.field, $.array[0].field
 */
function resolveJsonPath(obj, path) {
  if (!path.startsWith('$')) {
    return getNestedValue(obj, path);
  }

  // Remove leading $. or $
  const normalizedPath = path.replace(/^\$\.?/, '');

  if (!normalizedPath) {
    return obj;
  }

  // Convert bracket notation to dot notation
  const dotPath = normalizedPath.replace(/\[(\d+)\]/g, '.$1');

  return getNestedValue(obj, dotPath);
}

export default {
  resolveInputs,
  resolveValue,
  getNestedValue,
  evaluateCondition,
  evaluateCompoundCondition,
  renderTemplate,
  mapOutput
};
