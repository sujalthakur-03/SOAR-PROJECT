/**
 * Helper functions for backend operations
 */

/**
 * Replace template variables in a string
 * Example: "{{source_ip}}" with context {source_ip: "192.168.1.1"}
 */
export function replaceVariables(template, context) {
  if (!template) return template;

  let result = template;
  const matches = template.match(/\{\{(\w+)\}\}/g);

  if (matches) {
    matches.forEach(match => {
      const key = match.replace(/\{\{|\}\}/g, '');
      const value = getNestedValue(context, key);
      if (value !== undefined) {
        result = result.replace(match, value);
      }
    });
  }

  return result;
}

/**
 * Get nested object value by dot notation
 * Example: getNestedValue({a: {b: {c: 1}}}, 'a.b.c') => 1
 */
export function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Set nested object value by dot notation
 */
export function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  const lastKey = keys.pop();
  const target = keys.reduce((current, key) => {
    if (!current[key]) current[key] = {};
    return current[key];
  }, obj);
  target[lastKey] = value;
}

/**
 * Evaluate a simple condition expression
 * Supports: >, <, >=, <=, ==, !=, contains
 */
export function evaluateCondition(expression, context) {
  try {
    // Replace variables in expression
    let processedExpr = replaceVariables(expression, context);

    // Handle 'contains' operator
    if (processedExpr.includes('contains')) {
      const match = processedExpr.match(/(\S+)\s+contains\s+(\S+)/);
      if (match) {
        const [, left, right] = match;
        const leftVal = getNestedValue(context, left) || left;
        const rightVal = right.replace(/['"]/g, '');
        return String(leftVal).includes(rightVal);
      }
    }

    // Handle comparison operators
    const operators = ['>=', '<=', '>', '<', '==', '!='];
    for (const op of operators) {
      if (processedExpr.includes(op)) {
        const [left, right] = processedExpr.split(op).map(s => s.trim());
        const leftVal = parseFloat(getNestedValue(context, left) || left);
        const rightVal = parseFloat(right);

        switch (op) {
          case '>': return leftVal > rightVal;
          case '<': return leftVal < rightVal;
          case '>=': return leftVal >= rightVal;
          case '<=': return leftVal <= rightVal;
          case '==': return leftVal === rightVal;
          case '!=': return leftVal !== rightVal;
        }
      }
    }

    return false;
  } catch (error) {
    console.error('Error evaluating condition:', error);
    return false;
  }
}

/**
 * Generate unique ID
 */
export function generateId(prefix) {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `${prefix}-${timestamp}${random}`.toUpperCase();
}

/**
 * Sleep/delay function
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      const delay = baseDelay * Math.pow(2, attempt);
      await sleep(delay);
    }
  }
}
