/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.0 — CONNECTOR CONTRACT INTERFACE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Strict interface for connector invocation.
 * All connectors MUST implement this contract.
 *
 * NO vendor-specific logic in the engine.
 * Connectors are BLACK BOXES that transform inputs → outputs.
 *
 * VERSION: 1.0.0
 * AUTHOR: CyberSentinel SOAR Team
 * ══════════════════════════════════════════════════════════════════════════════
 */

import mongoose from 'mongoose';
import Connector from '../models/connector.js';
import { incrementMetric } from '../services/metrics-service.js';
import logger from '../utils/logger.js';
import { cybersentinelBlocklistConnector } from '../connectors/cybersentinel-blocklist.connector.js';
import { virustotalConnector } from '../connectors/virustotal.connector.js';
import { emailConnector } from '../connectors/email.connector.js';
import { alienvaultOtxConnector } from '../connectors/alienvault-otx.connector.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTOR CONTRACT SPECIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * CONNECTOR CONTRACT
 *
 * Every connector MUST:
 *
 * 1. IMPLEMENT a standard interface:
 *    async execute(action, inputs, config) → ConnectorResult
 *
 * 2. ACCEPT inputs matching its declared input_schema
 *
 * 3. RETURN outputs matching its declared output_schema
 *
 * 4. HANDLE timeouts gracefully (via AbortController or equivalent)
 *
 * 5. NORMALIZE errors to standard format:
 *    { code: string, message: string, retryable: boolean }
 *
 * 6. NEVER throw unhandled exceptions - always return ConnectorResult
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * INPUT SCHEMA (per action):
 * {
 *   "action_type": "lookup_ip",
 *   "required_fields": ["ip_address"],
 *   "optional_fields": ["max_age_days"],
 *   "field_types": {
 *     "ip_address": "string:ip",
 *     "max_age_days": "number:int"
 *   }
 * }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * OUTPUT SCHEMA (per action):
 * {
 *   "action_type": "lookup_ip",
 *   "output_fields": {
 *     "abuse_score": "number:0-100",
 *     "country_code": "string:iso2",
 *     "is_malicious": "boolean",
 *     "raw_response": "object"
 *   }
 * }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * CONNECTOR RESULT:
 * {
 *   success: boolean,
 *   output: object | null,
 *   error: { code: string, message: string, retryable: boolean } | null,
 *   duration_ms: number,
 *   metadata: { requests_made: number, rate_limited: boolean }
 * }
 */

// ═══════════════════════════════════════════════════════════════════════════════
// STANDARD ERROR CODES
// ═══════════════════════════════════════════════════════════════════════════════

export const ConnectorErrorCodes = Object.freeze({
  // Connection errors (retryable)
  TIMEOUT: { code: 'CONNECTOR_TIMEOUT', retryable: true },
  CONNECTION_FAILED: { code: 'CONNECTION_FAILED', retryable: true },
  SERVICE_UNAVAILABLE: { code: 'SERVICE_UNAVAILABLE', retryable: true },
  RATE_LIMITED: { code: 'RATE_LIMITED', retryable: true },

  // Client errors (not retryable)
  INVALID_INPUT: { code: 'INVALID_INPUT', retryable: false },
  AUTHENTICATION_FAILED: { code: 'AUTH_FAILED', retryable: false },
  FORBIDDEN: { code: 'FORBIDDEN', retryable: false },
  NOT_FOUND: { code: 'NOT_FOUND', retryable: false },
  INVALID_ACTION: { code: 'INVALID_ACTION', retryable: false },

  // Internal errors
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', retryable: false },
  NOT_IMPLEMENTED: { code: 'NOT_IMPLEMENTED', retryable: false }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTOR RESULT CLASS
// ═══════════════════════════════════════════════════════════════════════════════

export class ConnectorResult {
  constructor({ success, output = null, error = null, duration_ms = 0, metadata = {} }) {
    this.success = success;
    this.output = output;
    this.error = error;
    this.duration_ms = duration_ms;
    this.metadata = metadata;
  }

  static success(output, duration_ms = 0, metadata = {}) {
    return new ConnectorResult({
      success: true,
      output,
      duration_ms,
      metadata
    });
  }

  static failure(errorCode, message, duration_ms = 0, metadata = {}) {
    const errorDef = ConnectorErrorCodes[errorCode] || ConnectorErrorCodes.INTERNAL_ERROR;
    return new ConnectorResult({
      success: false,
      error: {
        code: errorDef.code,
        message,
        retryable: errorDef.retryable
      },
      duration_ms,
      metadata
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTOR REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Registry of connector implementations
 * Maps connector_id → connector implementation
 */
const connectorRegistry = new Map();

/**
 * Register a connector implementation
 */
export function registerConnector(connectorId, implementation) {
  if (typeof implementation.execute !== 'function') {
    throw new Error(`Connector ${connectorId} must implement execute(action, inputs, config) method`);
  }
  connectorRegistry.set(connectorId, implementation);
  logger.info(`[ConnectorRegistry] Registered connector: ${connectorId}`);
}

/**
 * Get connector implementation
 */
function getConnector(connectorId) {
  return connectorRegistry.get(connectorId);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN CONNECTOR INVOCATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Invoke a connector action
 *
 * This is the ONLY entry point for executing connector actions.
 * All connector invocations go through this function.
 *
 * @param {string} connectorId - Connector identifier
 * @param {string} actionType - Action to perform
 * @param {object} inputs - Resolved input parameters
 * @param {number} timeoutSeconds - Maximum execution time
 * @returns {Promise<object>} - Action result (output or error)
 */
export async function invokeConnector(connectorId, actionType, inputs, timeoutSeconds = 30) {
  const startTime = Date.now();

  logger.info(`[invokeConnector] Invoking ${connectorId}.${actionType}`);

  try {
    // Get connector configuration from database (try by _id first, then by name)
    let connectorConfig;
    if (mongoose.Types.ObjectId.isValid(connectorId)) {
      connectorConfig = await Connector.findById(connectorId);
    }
    if (!connectorConfig) {
      connectorConfig = await Connector.findOne({ name: connectorId });
    }

    if (!connectorConfig) {
      throw createError('INVALID_ACTION', `Connector not found: ${connectorId}`);
    }

    if (connectorConfig.status !== 'active') {
      throw createError('SERVICE_UNAVAILABLE', `Connector is not active: ${connectorId}`);
    }

    // Get connector implementation (try by name, type, or raw connectorId)
    const implementation = getConnector(connectorConfig.name) || getConnector(connectorConfig.type) || getConnector(connectorId);

    if (!implementation) {
      throw createError('NOT_IMPLEMENTED', `No implementation for connector: ${connectorId}`);
    }

    // Validate inputs against schema (if defined)
    if (implementation.inputSchema?.[actionType]) {
      validateInputs(inputs, implementation.inputSchema[actionType]);
    }

    // Create timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(createError('TIMEOUT', `Connector timeout after ${timeoutSeconds}s`));
      }, timeoutSeconds * 1000);
    });

    // Execute connector with timeout
    const result = await Promise.race([
      implementation.execute(actionType, inputs, connectorConfig.config),
      timeoutPromise
    ]);

    const duration = Date.now() - startTime;

    // Record execution in connector stats
    await connectorConfig.recordExecution(true);
    await incrementMetric('connector_invocations_success', { connector: connectorId });

    logger.info(`[invokeConnector] ${connectorId}.${actionType} completed in ${duration}ms`);

    // Validate output against schema (if defined)
    if (implementation.outputSchema?.[actionType]) {
      validateOutput(result, implementation.outputSchema[actionType]);
    }

    return result;

  } catch (error) {
    const duration = Date.now() - startTime;

    // Normalize error
    const normalizedError = normalizeError(error);

    logger.error(`[invokeConnector] ${connectorId}.${actionType} failed: ${normalizedError.message}`);

    // Record failed execution
    try {
      const connectorConfig = await Connector.findOne({ name: connectorId });
      if (connectorConfig) {
        await connectorConfig.recordExecution(false);
      }
    } catch (recordError) {
      logger.warn(`Failed to record connector execution: ${recordError.message}`);
    }

    await incrementMetric('connector_invocations_failed', { connector: connectorId });

    // Create error with retryable flag
    const errorResult = new Error(normalizedError.message);
    errorResult.code = normalizedError.code;
    errorResult.retryable = normalizedError.retryable;
    throw errorResult;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INPUT/OUTPUT VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate inputs against schema
 */
function validateInputs(inputs, schema) {
  const required = schema.required_fields || [];

  for (const field of required) {
    if (inputs[field] === undefined || inputs[field] === null) {
      throw createError('INVALID_INPUT', `Missing required field: ${field}`);
    }
  }

  // Type validation
  if (schema.field_types) {
    for (const [field, type] of Object.entries(schema.field_types)) {
      if (inputs[field] !== undefined) {
        validateFieldType(field, inputs[field], type);
      }
    }
  }
}

/**
 * Validate field type
 */
function validateFieldType(field, value, type) {
  const [baseType, constraint] = type.split(':');

  switch (baseType) {
    case 'string':
      if (typeof value !== 'string') {
        throw createError('INVALID_INPUT', `Field ${field} must be a string`);
      }
      if (constraint === 'ip') {
        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (!ipRegex.test(value)) {
          throw createError('INVALID_INPUT', `Field ${field} must be a valid IP address`);
        }
      }
      break;

    case 'number':
      if (typeof value !== 'number') {
        throw createError('INVALID_INPUT', `Field ${field} must be a number`);
      }
      break;

    case 'boolean':
      if (typeof value !== 'boolean') {
        throw createError('INVALID_INPUT', `Field ${field} must be a boolean`);
      }
      break;

    case 'array':
      if (!Array.isArray(value)) {
        throw createError('INVALID_INPUT', `Field ${field} must be an array`);
      }
      break;
  }
}

/**
 * Validate output against schema
 */
function validateOutput(output, schema) {
  // Basic output validation - ensure it's an object
  if (typeof output !== 'object' || output === null) {
    logger.warn('[validateOutput] Output is not an object');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a connector error
 */
function createError(code, message) {
  const errorDef = ConnectorErrorCodes[code] || ConnectorErrorCodes.INTERNAL_ERROR;
  const error = new Error(message);
  error.code = errorDef.code;
  error.retryable = errorDef.retryable;
  return error;
}

/**
 * Normalize any error to connector error format
 */
function normalizeError(error) {
  // Already normalized
  if (error.code && typeof error.retryable === 'boolean') {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable
    };
  }

  // HTTP errors
  if (error.status || error.statusCode) {
    const status = error.status || error.statusCode;

    if (status === 401 || status === 403) {
      return {
        code: 'AUTH_FAILED',
        message: error.message || 'Authentication failed',
        retryable: false
      };
    }

    if (status === 404) {
      return {
        code: 'NOT_FOUND',
        message: error.message || 'Resource not found',
        retryable: false
      };
    }

    if (status === 429) {
      return {
        code: 'RATE_LIMITED',
        message: error.message || 'Rate limited',
        retryable: true
      };
    }

    if (status >= 500) {
      return {
        code: 'SERVICE_UNAVAILABLE',
        message: error.message || 'Service unavailable',
        retryable: true
      };
    }
  }

  // Timeout errors
  if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT' || error.message?.includes('timeout')) {
    return {
      code: 'CONNECTOR_TIMEOUT',
      message: error.message || 'Request timed out',
      retryable: true
    };
  }

  // Connection errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ECONNRESET') {
    return {
      code: 'CONNECTION_FAILED',
      message: error.message || 'Connection failed',
      retryable: true
    };
  }

  // Default: internal error
  return {
    code: 'INTERNAL_ERROR',
    message: error.message || 'Unknown error',
    retryable: false
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTOR IMPLEMENTATION EXAMPLE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Example connector implementation template
 *
 * const abuseipdbConnector = {
 *   inputSchema: {
 *     lookup_ip: {
 *       required_fields: ['ip_address'],
 *       optional_fields: ['max_age_days'],
 *       field_types: {
 *         ip_address: 'string:ip',
 *         max_age_days: 'number:int'
 *       }
 *     }
 *   },
 *
 *   outputSchema: {
 *     lookup_ip: {
 *       output_fields: {
 *         abuse_score: 'number',
 *         country_code: 'string',
 *         is_malicious: 'boolean'
 *       }
 *     }
 *   },
 *
 *   async execute(action, inputs, config) {
 *     switch (action) {
 *       case 'lookup_ip':
 *         const response = await fetch(`${config.api_url}/check`, {
 *           method: 'GET',
 *           headers: { 'Key': config.api_key },
 *           params: { ipAddress: inputs.ip_address }
 *         });
 *         const data = await response.json();
 *         return {
 *           abuse_score: data.abuseConfidenceScore,
 *           country_code: data.countryCode,
 *           is_malicious: data.abuseConfidenceScore > 80
 *         };
 *
 *       default:
 *         throw new Error(`Unknown action: ${action}`);
 *     }
 *   }
 * };
 *
 * registerConnector('abuseipdb', abuseipdbConnector);
 */

// ═══════════════════════════════════════════════════════════════════════════════
// BUILT-IN CONNECTOR REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════

registerConnector('cybersentinel_blocklist', cybersentinelBlocklistConnector);
registerConnector('virustotal', virustotalConnector);
registerConnector('email', emailConnector);
registerConnector('alienvault-otx', alienvaultOtxConnector);

export default {
  ConnectorResult,
  ConnectorErrorCodes,
  invokeConnector,
  registerConnector,
  getConnector
};
