/**
 * Webhook Routes
 * Handles playbook-specific webhook ingestion
 * Each webhook validates secret, payload schema, and matching rules
 */

import express from 'express';
import { Playbook, Execution, AuditLog } from '../models/index.js';
import { ExecutionState, StepState } from '../models/execution.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * Playbook-specific webhook endpoint
 * POST /api/webhooks/:playbook_id/:secret
 *
 * Validation order:
 * 1. Verify playbook exists (by playbook_id, NOT MongoDB _id)
 * 2. Verify webhook is enabled
 * 3. Verify secret matches
 * 4. Validate payload is JSON
 * 5. Validate payload against schema (if defined)
 * 6. Apply matching rules (if defined)
 * 7. Create execution with trigger_data
 * 8. Start execution engine (async)
 * 9. Return 202 Accepted with execution_id
 */
router.post('/:playbook_id/:secret', async (req, res) => {
  const startTime = Date.now();
  const { playbook_id, secret } = req.params;

  try {
    // STEP 1: Fetch playbook by playbook_id (NOT MongoDB _id)
    const playbook = await Playbook.findOne({ playbook_id });
    if (!playbook) {
      logger.warn(`Webhook called for non-existent playbook: ${playbook_id}`);
      return res.status(404).json({
        error: 'Playbook not found',
        message: 'The specified playbook does not exist'
      });
    }

    // STEP 2: Verify webhook is enabled
    if (!playbook.webhook || !playbook.webhook.enabled) {
      logger.warn(`Webhook disabled for playbook: ${playbook_id} (${playbook.name})`);

      await AuditLog.log({
        action: 'webhook_triggered',
        resource_type: 'webhook',
        resource_id: playbook_id,
        resource_name: playbook.name,
        outcome: 'failure',
        error_message: 'Webhook is disabled',
        details: { playbook_id }
      });

      return res.status(403).json({
        error: 'Webhook disabled',
        message: 'This webhook endpoint is currently disabled'
      });
    }

    // STEP 3: Verify secret key
    if (secret !== playbook.webhook.secret) {
      logger.warn(`Invalid webhook secret for playbook: ${playbook_id} (${playbook.name})`);

      await AuditLog.log({
        action: 'webhook_triggered',
        resource_type: 'webhook',
        resource_id: playbook_id,
        resource_name: playbook.name,
        outcome: 'failure',
        error_message: 'Invalid secret key',
        details: { playbook_id }
      });

      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid webhook secret'
      });
    }

    // STEP 4: Validate payload is JSON
    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      logger.warn(`Invalid payload for webhook: ${playbook_id} (${playbook.name})`);
      return res.status(400).json({
        error: 'Invalid payload',
        message: 'Payload must be a valid JSON object'
      });
    }

    // STEP 5: Validate payload against expected schema (if defined)
    if (playbook.expected_schema && Object.keys(playbook.expected_schema).length > 0) {
      const schemaValidation = validateSchema(payload, playbook.expected_schema);
      if (!schemaValidation.valid) {
        logger.warn(`Schema validation failed for webhook: ${playbook_id}`, schemaValidation.errors);
        return res.status(400).json({
          error: 'Schema validation failed',
          message: 'Payload does not match expected schema',
          errors: schemaValidation.errors
        });
      }
    }

    // STEP 6: Apply matching rules (if defined)
    if (playbook.matching_rules && Object.keys(playbook.matching_rules).length > 0) {
      const matchResult = evaluateMatchingRules(payload, playbook.matching_rules);
      if (!matchResult.matched) {
        logger.info(`Matching rules not satisfied for webhook: ${playbook_id}`, matchResult.reason);

        await AuditLog.log({
          action: 'webhook_triggered',
          resource_type: 'webhook',
          resource_id: playbook_id,
          resource_name: playbook.name,
          outcome: 'success',
          details: {
            playbook_id,
            matched: false,
            reason: matchResult.reason,
            discarded: true
          }
        });

        return res.status(200).json({
          received: true,
          matched: false,
          message: 'Alert received but did not match playbook rules',
          reason: matchResult.reason
        });
      }
    }

    // STEP 7: Create execution document
    // ALL alert context is in trigger_data - no fields extracted to root
    const execution = new Execution({
      playbook_id: playbook.playbook_id,  // Use logical playbook_id
      playbook_name: playbook.name,
      state: ExecutionState.EXECUTING,
      trigger_data: payload,  // Store complete payload as trigger_data
      started_at: new Date(),
      steps: playbook.steps.map(step => ({
        step_id: step.step_id,
        state: StepState.PENDING
      }))
    });

    await execution.save();

    logger.info(`Execution created: ${execution.execution_id} for playbook: ${playbook.name} (${playbook_id})`);

    // Log successful webhook trigger
    await AuditLog.log({
      action: 'webhook_triggered',
      resource_type: 'webhook',
      resource_id: playbook_id,
      resource_name: playbook.name,
      outcome: 'success',
      details: {
        playbook_id,
        execution_id: execution.execution_id,
        matched: true,
        processing_time_ms: Date.now() - startTime
      }
    });

    // STEP 8: Start execution engine asynchronously (non-blocking)
    setImmediate(() => {
      startExecutionAsync(execution.execution_id).catch(error => {
        logger.error(`Failed to start execution ${execution.execution_id}:`, error);
      });
    });

    // STEP 9: Return 202 Accepted immediately
    // Return human-readable execution_id (NOT MongoDB _id)
    return res.status(202).json({
      received: true,
      matched: true,
      execution_id: execution.execution_id,
      playbook_id: playbook.playbook_id,
      playbook_name: playbook.name,
      state: ExecutionState.EXECUTING,
      message: 'Alert received and execution started'
    });

  } catch (error) {
    logger.error(`Webhook processing error for playbook ${playbook_id}:`, error);

    await AuditLog.log({
      action: 'webhook_triggered',
      resource_type: 'webhook',
      resource_id: playbook_id,
      outcome: 'failure',
      error_message: error.message,
      details: { playbook_id, error: error.stack }
    });

    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to process webhook'
    });
  }
});

/**
 * Validate payload against expected schema
 */
function validateSchema(payload, schema) {
  const errors = [];

  for (const [field, rules] of Object.entries(schema)) {
    if (rules.required && !(field in payload)) {
      errors.push(`Missing required field: ${field}`);
    }

    if (field in payload) {
      const value = payload[field];

      if (rules.type) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== rules.type) {
          errors.push(`Field '${field}' must be of type ${rules.type}, got ${actualType}`);
        }
      }

      if (rules.enum && !rules.enum.includes(value)) {
        errors.push(`Field '${field}' must be one of: ${rules.enum.join(', ')}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Evaluate matching rules against payload
 */
function evaluateMatchingRules(payload, rules) {
  try {
    for (const [field, condition] of Object.entries(rules)) {
      const value = getNestedValue(payload, field);

      if (condition.equals !== undefined) {
        if (value !== condition.equals) {
          return {
            matched: false,
            reason: `Field '${field}' does not equal '${condition.equals}'`
          };
        }
      }

      if (condition.contains !== undefined) {
        if (typeof value !== 'string' || !value.includes(condition.contains)) {
          return {
            matched: false,
            reason: `Field '${field}' does not contain '${condition.contains}'`
          };
        }
      }

      if (condition.gt !== undefined && value <= condition.gt) {
        return {
          matched: false,
          reason: `Field '${field}' is not greater than ${condition.gt}`
        };
      }

      if (condition.lt !== undefined && value >= condition.lt) {
        return {
          matched: false,
          reason: `Field '${field}' is not less than ${condition.lt}`
        };
      }

      if (condition.in !== undefined) {
        if (!Array.isArray(condition.in) || !condition.in.includes(value)) {
          return {
            matched: false,
            reason: `Field '${field}' is not in allowed values`
          };
        }
      }

      if (condition.regex !== undefined) {
        const regex = new RegExp(condition.regex);
        if (!regex.test(String(value))) {
          return {
            matched: false,
            reason: `Field '${field}' does not match pattern`
          };
        }
      }
    }

    return { matched: true };
  } catch (error) {
    logger.error('Error evaluating matching rules:', error);
    return {
      matched: false,
      reason: 'Failed to evaluate matching rules'
    };
  }
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Start execution asynchronously
 * @param {string} executionId - Human-readable execution_id (e.g., "EXE-20260116-A1B2C3")
 */
async function startExecutionAsync(executionId) {
  try {
    logger.info(`Execution ${executionId} is now EXECUTING`);

    // Execution is already in EXECUTING state from creation
    // The actual step execution engine would be called here

    // TODO: Integrate with actual execution engine
    // For now, this is a placeholder
    logger.info(`Execution ${executionId} ready for step processing`);

  } catch (error) {
    logger.error(`Failed to process execution ${executionId}:`, error);

    try {
      // Lookup by human-readable execution_id (NOT MongoDB _id)
      const execution = await Execution.findOne({ execution_id: executionId });
      if (execution) {
        await execution.fail(error);
      }
    } catch (updateError) {
      logger.error('Failed to update failed execution:', updateError);
    }
  }
}

/**
 * Health check for webhook service
 */
router.get('/health', (req, res) => {
  res.json({
    service: 'Webhook Ingestion',
    healthy: true,
    timestamp: new Date().toISOString()
  });
});

export default router;
