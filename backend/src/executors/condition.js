/**
 * Condition Step Executor
 * Evaluates conditional logic to determine workflow branching
 */

import logger from '../utils/logger.js';
import { evaluateCondition, getNestedValue } from '../utils/helpers.js';

/**
 * Execute condition step
 */
export async function executeCondition(step, alert, context) {
  logger.info(`Executing condition step: ${step.name}`);

  const config = step.config;

  try {
    let result;

    if (config.expression) {
      // Expression-based condition (e.g., "ip_reputation.abuse_score > 80")
      result = evaluateCondition(config.expression, { ...alert, ...context });
    } else if (config.field && config.operator && config.value !== undefined) {
      // Field-based condition
      result = evaluateFieldCondition(config, { ...alert, ...context });
    } else {
      throw new Error('Invalid condition configuration');
    }

    const nextStep = result ? config.on_true : config.on_false;

    logger.info(`✅ Condition evaluated: ${step.name} => ${result} (next: ${nextStep || 'continue'})`);

    return {
      success: true,
      output: {
        result,
        next_step: nextStep
      }
    };

  } catch (error) {
    logger.error(`❌ Condition evaluation failed: ${step.name}`, error);
    throw error;
  }
}

/**
 * Evaluate field-based condition
 */
function evaluateFieldCondition(config, context) {
  const fieldValue = getNestedValue(context, config.field);
  const compareValue = config.value;
  const operator = config.operator;

  logger.debug(`Evaluating: ${fieldValue} ${operator} ${compareValue}`);

  switch (operator) {
    case 'equals':
    case '==':
      return fieldValue == compareValue;

    case 'not_equals':
    case '!=':
      return fieldValue != compareValue;

    case 'greater_than':
    case '>':
      return parseFloat(fieldValue) > parseFloat(compareValue);

    case 'less_than':
    case '<':
      return parseFloat(fieldValue) < parseFloat(compareValue);

    case 'greater_than_or_equal':
    case '>=':
      return parseFloat(fieldValue) >= parseFloat(compareValue);

    case 'less_than_or_equal':
    case '<=':
      return parseFloat(fieldValue) <= parseFloat(compareValue);

    case 'contains':
      return String(fieldValue).includes(String(compareValue));

    case 'not_contains':
      return !String(fieldValue).includes(String(compareValue));

    case 'starts_with':
      return String(fieldValue).startsWith(String(compareValue));

    case 'ends_with':
      return String(fieldValue).endsWith(String(compareValue));

    case 'regex':
      return new RegExp(compareValue).test(String(fieldValue));

    default:
      throw new Error(`Unknown operator: ${operator}`);
  }
}

export default {
  executeCondition
};
