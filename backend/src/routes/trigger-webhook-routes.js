/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.0 — TRIGGER & WEBHOOK API ROUTES
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * API endpoints for webhook ingestion, trigger management, and webhook lifecycle.
 *
 * ENDPOINTS:
 * ─────────────────────────────────────────────────────────────────────────────
 * INGESTION:
 *   POST /api/webhooks/:webhook_id         - Main ingestion endpoint
 *
 * WEBHOOK MANAGEMENT:
 *   POST   /api/playbooks/:id/webhook      - Create webhook for playbook
 *   GET    /api/playbooks/:id/webhook      - Get webhook info
 *   DELETE /api/webhooks/:webhook_id       - Delete webhook
 *   POST   /api/webhooks/:webhook_id/rotate - Rotate secret
 *   PATCH  /api/webhooks/:webhook_id/toggle - Enable/disable webhook
 *
 * TRIGGER MANAGEMENT:
 *   POST   /api/playbooks/:id/trigger      - Create/update trigger
 *   GET    /api/triggers/:trigger_id       - Get trigger details
 *   PUT    /api/triggers/:trigger_id       - Update trigger
 *   DELETE /api/triggers/:trigger_id       - Delete trigger
 *   PATCH  /api/triggers/:trigger_id/toggle - Enable/disable trigger
 *
 * VERSION: 1.0.0
 * AUTHOR: CyberSentinel SOAR Team
 * ══════════════════════════════════════════════════════════════════════════════
 */

import express from 'express';
import Webhook from '../models/webhook.js';
import Trigger from '../models/trigger.js';
import Playbook from '../models/playbook.js';
import PlaybookVersioned from '../models/playbook-v2.js';
import {
  processWebhookIngestion,
  createWebhookForPlaybook,
  deleteWebhookForPlaybook,
  getWebhookInfo,
  IngestionResult,
  normalizeEventTime,
  generateFingerprint
} from '../engine/webhook-ingestion.js';
import Execution, { ExecutionState, StepState } from '../models/execution.js';
import crypto from 'crypto';
import { validateTriggerDefinition } from '../engine/trigger-engine.js';
import { logAction } from '../services/audit-service.js';
import logger from '../utils/logger.js';

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Find playbook by ID (supports both legacy and versioned models)
// ═══════════════════════════════════════════════════════════════════════════════

async function findPlaybook(playbookId) {
  // Try legacy Playbook model first (playbook_id field)
  let playbook = await Playbook.findOne({ playbook_id: playbookId });

  // Fall back to MongoDB _id (only if valid ObjectId format)
  if (!playbook) {
    try {
      playbook = await Playbook.findById(playbookId);
    } catch (e) {
      // Invalid ObjectId format, ignore
    }
  }

  // Check PlaybookVersioned (v2 versioned playbooks)
  if (!playbook) {
    const versioned = await PlaybookVersioned.findOne({ playbook_id: playbookId, enabled: true });
    if (versioned) {
      return versioned;
    }
  }

  return playbook;
}

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════════
// INGESTION ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/webhooks/:webhook_id
 *
 * Main webhook ingestion endpoint.
 * Receives alerts from CyberSentinel Forwarder.
 *
 * Authentication: X-Webhook-Secret header or ?secret= query param
 *
 * Returns:
 *   202 - Execution created
 *   200 - Alert dropped (no match or duplicate)
 *   401 - Invalid secret
 *   404 - Webhook not found
 *   429 - Rate limited
 *   500 - Internal error
 */
router.post('/webhooks/:webhook_id', async (req, res) => {
  const { webhook_id } = req.params;

  // Extract secret from header or query param
  const secret = req.headers['x-webhook-secret'] ||
                 req.headers['x-cybersentinel-secret'] ||
                 req.query.secret;

  const alertPayload = req.body;

  try {
    const result = await processWebhookIngestion(webhook_id, secret, alertPayload);

    // Log decision (NO alert dump)
    logger.info('[Webhook] Request processed', result.toLogObject());

    // Return appropriate response
    if (result.decision === 'accepted') {
      return res.status(202).json({
        status: 'accepted',
        execution_id: result.execution_id,
        playbook_id: result.playbook_id,
        trigger_id: result.trigger_id,
        latency_ms: result.latency_ms
      });
    }

    if (result.decision === 'dropped') {
      return res.status(200).json({
        status: 'dropped',
        reason: result.drop_reason,
        playbook_id: result.playbook_id,
        latency_ms: result.latency_ms
      });
    }

    if (result.decision === 'rejected') {
      return res.status(result.http_status).json({
        status: 'rejected',
        reason: result.reject_reason
      });
    }

    // Error case
    return res.status(500).json({
      status: 'error',
      message: result.error
    });

  } catch (error) {
    logger.error(`[Webhook] Unhandled error: ${error.message}`, { webhook_id });
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/playbooks/:id/webhook
 *
 * Create webhook and trigger for a playbook.
 */
router.post('/playbooks/:id/webhook', async (req, res) => {
  const { id: playbookId } = req.params;
  const userId = req.user?.email || 'system';

  try {
    // Validate playbook exists (supports both legacy and versioned models)
    const playbook = await findPlaybook(playbookId);

    if (!playbook) {
      return res.status(404).json({ error: 'Playbook not found' });
    }

    const playbookIdToUse = playbook.playbook_id || playbookId;

    // Check if webhook already exists
    const existingWebhook = await Webhook.findByPlaybookId(playbookIdToUse);
    if (existingWebhook) {
      return res.status(409).json({
        error: 'Webhook already exists for this playbook',
        webhook_id: existingWebhook.webhook_id
      });
    }

    // Validate trigger definition
    const triggerDef = req.body.trigger || req.body;
    const validation = validateTriggerDefinition(triggerDef);

    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid trigger definition',
        details: validation.errors
      });
    }

    // Create webhook and trigger
    const { webhook, trigger } = await createWebhookForPlaybook(
      playbookIdToUse,
      triggerDef,
      userId
    );

    // Get base URL from request
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    return res.status(201).json({
      webhook_id: webhook.webhook_id,
      playbook_id: playbookIdToUse,
      url: webhook.getUrl(baseUrl),
      secret: webhook.secret,  // Only returned on creation
      trigger_id: trigger.trigger_id,
      created_at: webhook.created_at
    });

  } catch (error) {
    logger.error(`[WebhookAPI] Failed to create webhook: ${error.message}`);
    return res.status(500).json({ error: 'Failed to create webhook' });
  }
});

/**
 * GET /api/playbooks/:id/webhook
 *
 * Get webhook info for a playbook.
 */
router.get('/playbooks/:id/webhook', async (req, res) => {
  const { id: playbookId } = req.params;

  try {
    // Validate playbook exists (supports both legacy and versioned models)
    const playbook = await findPlaybook(playbookId);

    if (!playbook) {
      return res.status(404).json({ error: 'Playbook not found' });
    }

    const playbookIdToUse = playbook.playbook_id || playbookId;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const info = await getWebhookInfo(playbookIdToUse, baseUrl);

    if (!info) {
      return res.status(404).json({ error: 'No webhook configured for this playbook' });
    }

    return res.json(info);

  } catch (error) {
    logger.error(`[WebhookAPI] Failed to get webhook info: ${error.message}`);
    return res.status(500).json({ error: 'Failed to get webhook info' });
  }
});

/**
 * GET /api/webhooks/:webhook_id
 *
 * Get webhook details by webhook_id.
 */
router.get('/webhooks/:webhook_id', async (req, res) => {
  const { webhook_id } = req.params;

  try {
    const webhook = await Webhook.findOne({ webhook_id });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const trigger = await Trigger.findByWebhookId(webhook_id);
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    return res.json({
      webhook_id: webhook.webhook_id,
      playbook_id: webhook.playbook_id,
      url: webhook.getUrl(baseUrl),
      status: webhook.status,
      enabled: webhook.enabled,
      secret_prefix: webhook.secret_prefix,
      secret_rotated_at: webhook.secret_rotated_at,
      rate_limit: webhook.rate_limit,
      stats: webhook.stats,
      trigger: trigger ? {
        trigger_id: trigger.trigger_id,
        name: trigger.name,
        enabled: trigger.enabled
      } : null,
      created_at: webhook.created_at,
      updated_at: webhook.updated_at
    });

  } catch (error) {
    logger.error(`[WebhookAPI] Failed to get webhook: ${error.message}`);
    return res.status(500).json({ error: 'Failed to get webhook' });
  }
});

/**
 * DELETE /api/webhooks/:webhook_id
 *
 * Delete a webhook (and associated trigger).
 */
router.delete('/webhooks/:webhook_id', async (req, res) => {
  const { webhook_id } = req.params;
  const userId = req.user?.email || 'system';

  try {
    const webhook = await Webhook.findOne({ webhook_id });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    await deleteWebhookForPlaybook(webhook.playbook_id, userId);

    return res.json({
      status: 'deleted',
      webhook_id: webhook_id
    });

  } catch (error) {
    logger.error(`[WebhookAPI] Failed to delete webhook: ${error.message}`);
    return res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

/**
 * POST /api/webhooks/:webhook_id/rotate
 *
 * Rotate webhook secret.
 */
router.post('/webhooks/:webhook_id/rotate', async (req, res) => {
  const { webhook_id } = req.params;
  const userId = req.user?.email || 'system';

  try {
    const webhook = await Webhook.findOne({ webhook_id }).select('+secret');

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const newSecret = await webhook.rotateSecret();

    await logAction({
      action: 'webhook.secret_rotated',
      resource_type: 'webhook',
      resource_id: webhook_id,
      actor_email: userId,
      details: { rotation_count: webhook.secret_rotation_count },
      outcome: 'success'
    });

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    return res.json({
      webhook_id: webhook_id,
      url: webhook.getUrl(baseUrl),
      secret: newSecret,  // New secret returned
      secret_prefix: newSecret.substring(0, 8),
      rotated_at: webhook.secret_rotated_at,
      rotation_count: webhook.secret_rotation_count
    });

  } catch (error) {
    logger.error(`[WebhookAPI] Failed to rotate secret: ${error.message}`);
    return res.status(500).json({ error: 'Failed to rotate secret' });
  }
});

/**
 * PATCH /api/webhooks/:webhook_id/toggle
 *
 * Enable or disable a webhook.
 */
router.patch('/webhooks/:webhook_id/toggle', async (req, res) => {
  const { webhook_id } = req.params;
  const { enabled } = req.body;
  const userId = req.user?.email || 'system';

  try {
    const webhook = await Webhook.findOne({ webhook_id });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    if (enabled === true) {
      await webhook.enable();
    } else if (enabled === false) {
      await webhook.disable();
    } else {
      return res.status(400).json({ error: 'enabled must be true or false' });
    }

    await logAction({
      action: enabled ? 'webhook.enabled' : 'webhook.disabled',
      resource_type: 'webhook',
      resource_id: webhook_id,
      actor_email: userId,
      outcome: 'success'
    });

    return res.json({
      webhook_id: webhook_id,
      enabled: webhook.enabled,
      status: webhook.status
    });

  } catch (error) {
    logger.error(`[WebhookAPI] Failed to toggle webhook: ${error.message}`);
    return res.status(500).json({ error: 'Failed to toggle webhook' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TRIGGER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/playbooks/:id/trigger
 *
 * Create or update trigger for a playbook.
 */
router.post('/playbooks/:id/trigger', async (req, res) => {
  const { id: playbookId } = req.params;
  const userId = req.user?.email || 'system';

  try {
    // Validate playbook exists (supports both legacy and versioned models)
    const playbook = await findPlaybook(playbookId);

    if (!playbook) {
      return res.status(404).json({ error: 'Playbook not found' });
    }

    const playbookIdToUse = playbook.playbook_id || playbookId;

    // Validate trigger definition
    const validation = validateTriggerDefinition(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid trigger definition',
        details: validation.errors
      });
    }

    // Check if webhook exists
    const webhook = await Webhook.findByPlaybookId(playbookIdToUse);
    if (!webhook) {
      return res.status(400).json({
        error: 'Webhook must be created first. Use POST /api/playbooks/:id/webhook'
      });
    }

    // Check if trigger exists
    let trigger = await Trigger.findByPlaybookId(playbookIdToUse);

    if (trigger) {
      // Update existing trigger via createNewVersion (immutable versioning)
      try {
        trigger = await Trigger.createNewVersion(trigger.trigger_id, {
          name: req.body.name || trigger.name,
          description: req.body.description,
          conditions: req.body.conditions,
          match: req.body.match || 'ALL',
          alert_categories: req.body.alert_categories || [],
        }, userId);
      } catch (versionError) {
        // Fall back to direct update if versioning fails
        logger.warn(`[TriggerAPI] Versioned update failed, falling back: ${versionError.message}`);
        trigger.name = req.body.name || trigger.name;
        trigger.description = req.body.description;
        trigger.enabled = true;
        trigger.updated_by = userId;
        await trigger.save();
      }
    } else {
      // Create new trigger
      trigger = new Trigger({
        trigger_id: Trigger.generateTriggerId(playbookIdToUse),
        playbook_id: playbookIdToUse,
        webhook_id: webhook.webhook_id,
        name: req.body.name || `Trigger for ${playbookIdToUse}`,
        description: req.body.description,
        conditions: req.body.conditions,
        match: req.body.match || 'ALL',
        alert_categories: req.body.alert_categories || [],
        created_by: userId
      });
      await trigger.save();
    }

    await logAction({
      action: 'trigger.updated',
      resource_type: 'trigger',
      resource_id: trigger.trigger_id,
      actor_email: userId,
      details: { playbook_id: playbookIdToUse, conditions_count: trigger.conditions.length },
      outcome: 'success'
    });

    return res.status(trigger.isNew ? 201 : 200).json({
      trigger_id: trigger.trigger_id,
      playbook_id: trigger.playbook_id,
      webhook_id: trigger.webhook_id,
      name: trigger.name,
      conditions: trigger.conditions,
      match: trigger.match,
      enabled: trigger.enabled,
      version: trigger.version,
      updated_at: trigger.updated_at
    });

  } catch (error) {
    logger.error(`[TriggerAPI] Failed to create/update trigger: ${error.message}`);
    return res.status(500).json({ error: 'Failed to create/update trigger' });
  }
});

/**
 * GET /api/triggers/:trigger_id
 *
 * Get trigger details.
 */
router.get('/triggers/:trigger_id', async (req, res) => {
  const { trigger_id } = req.params;

  try {
    const trigger = await Trigger.findOne({ trigger_id });

    if (!trigger) {
      return res.status(404).json({ error: 'Trigger not found' });
    }

    return res.json({
      trigger_id: trigger.trigger_id,
      playbook_id: trigger.playbook_id,
      webhook_id: trigger.webhook_id,
      name: trigger.name,
      description: trigger.description,
      conditions: trigger.conditions,
      match: trigger.match,
      alert_categories: trigger.alert_categories,
      enabled: trigger.enabled,
      priority: trigger.priority,
      stats: trigger.stats,
      version: trigger.version,
      created_at: trigger.created_at,
      updated_at: trigger.updated_at
    });

  } catch (error) {
    logger.error(`[TriggerAPI] Failed to get trigger: ${error.message}`);
    return res.status(500).json({ error: 'Failed to get trigger' });
  }
});

/**
 * PUT /api/triggers/:trigger_id
 *
 * Update trigger.
 */
router.put('/triggers/:trigger_id', async (req, res) => {
  const { trigger_id } = req.params;
  const userId = req.user?.email || 'system';

  try {
    const trigger = await Trigger.findOne({ trigger_id });

    if (!trigger) {
      return res.status(404).json({ error: 'Trigger not found' });
    }

    // Validate if conditions are being updated
    if (req.body.conditions) {
      const validation = validateTriggerDefinition(req.body);
      if (!validation.valid) {
        return res.status(400).json({
          error: 'Invalid trigger definition',
          details: validation.errors
        });
      }
    }

    // Update fields
    if (req.body.name !== undefined) trigger.name = req.body.name;
    if (req.body.description !== undefined) trigger.description = req.body.description;
    if (req.body.conditions !== undefined) trigger.conditions = req.body.conditions;
    if (req.body.match !== undefined) trigger.match = req.body.match;
    if (req.body.alert_categories !== undefined) trigger.alert_categories = req.body.alert_categories;
    if (req.body.priority !== undefined) trigger.priority = req.body.priority;

    trigger.updated_by = userId;
    await trigger.save();

    await logAction({
      action: 'trigger.updated',
      resource_type: 'trigger',
      resource_id: trigger_id,
      actor_email: userId,
      outcome: 'success'
    });

    return res.json({
      trigger_id: trigger.trigger_id,
      name: trigger.name,
      conditions: trigger.conditions,
      match: trigger.match,
      enabled: trigger.enabled,
      version: trigger.version,
      updated_at: trigger.updated_at
    });

  } catch (error) {
    logger.error(`[TriggerAPI] Failed to update trigger: ${error.message}`);
    return res.status(500).json({ error: 'Failed to update trigger' });
  }
});

/**
 * DELETE /api/triggers/:trigger_id
 *
 * Delete trigger (webhook remains, but won't process alerts).
 */
router.delete('/triggers/:trigger_id', async (req, res) => {
  const { trigger_id } = req.params;
  const userId = req.user?.email || 'system';

  try {
    const trigger = await Trigger.findOne({ trigger_id });

    if (!trigger) {
      return res.status(404).json({ error: 'Trigger not found' });
    }

    await Trigger.deleteOne({ _id: trigger._id });

    await logAction({
      action: 'trigger.deleted',
      resource_type: 'trigger',
      resource_id: trigger_id,
      actor_email: userId,
      details: { playbook_id: trigger.playbook_id },
      outcome: 'success'
    });

    return res.json({
      status: 'deleted',
      trigger_id: trigger_id
    });

  } catch (error) {
    logger.error(`[TriggerAPI] Failed to delete trigger: ${error.message}`);
    return res.status(500).json({ error: 'Failed to delete trigger' });
  }
});

/**
 * PATCH /api/triggers/:trigger_id/toggle
 *
 * Enable or disable a trigger.
 */
router.patch('/triggers/:trigger_id/toggle', async (req, res) => {
  const { trigger_id } = req.params;
  const { enabled } = req.body;
  const userId = req.user?.email || 'system';

  try {
    const trigger = await Trigger.findOne({ trigger_id });

    if (!trigger) {
      return res.status(404).json({ error: 'Trigger not found' });
    }

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be true or false' });
    }

    trigger.enabled = enabled;
    trigger.updated_by = userId;
    await trigger.save();

    await logAction({
      action: enabled ? 'trigger.enabled' : 'trigger.disabled',
      resource_type: 'trigger',
      resource_id: trigger_id,
      actor_email: userId,
      outcome: 'success'
    });

    return res.json({
      trigger_id: trigger_id,
      enabled: trigger.enabled
    });

  } catch (error) {
    logger.error(`[TriggerAPI] Failed to toggle trigger: ${error.message}`);
    return res.status(500).json({ error: 'Failed to toggle trigger' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION BOOTSTRAP (MANUAL)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/executions/trigger
 *
 * Manually trigger an execution with custom data.
 * Bypasses webhook validation but still evaluates trigger conditions.
 */
router.post('/executions/trigger', async (req, res) => {
  const { playbook_id, trigger_data, bypass_trigger } = req.body;
  const userId = req.user?.email || 'system';

  try {
    if (!playbook_id) {
      return res.status(400).json({ error: 'playbook_id is required' });
    }

    if (!trigger_data || typeof trigger_data !== 'object') {
      return res.status(400).json({ error: 'trigger_data must be an object' });
    }

    const playbook = await findPlaybook(playbook_id);

    if (!playbook) {
      return res.status(404).json({ error: 'Playbook not found or inactive' });
    }

    const playbookIdToUse = playbook.playbook_id || playbook_id;

    // Optionally evaluate trigger conditions
    if (!bypass_trigger) {
      const trigger = await Trigger.findByPlaybookId(playbookIdToUse);

      if (trigger && trigger.enabled) {
        const { evaluateTrigger } = await import('../engine/trigger-engine.js');
        const result = evaluateTrigger(trigger, trigger_data);

        if (!result.matched) {
          return res.status(200).json({
            status: 'dropped',
            reason: result.drop_reason,
            message: 'Trigger conditions not met'
          });
        }
      }
    }

    // Build required execution fields for manual trigger
    const playbookObj = typeof playbook.toObject === 'function' ? playbook.toObject() : playbook;
    const playbookSteps = playbookObj.dsl?.steps || playbookObj.steps || [];
    const eventTimeResult = normalizeEventTime(trigger_data);
    const manualWebhookId = `MANUAL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const fingerprint = generateFingerprint(manualWebhookId, trigger_data, eventTimeResult.event_time);

    const execution = new Execution({
      playbook_id: playbookObj.playbook_id || playbook_id,
      playbook_name: playbookObj.name,
      state: ExecutionState.EXECUTING,
      trigger_data: trigger_data,
      trigger_source: 'manual',
      trigger_snapshot: {
        trigger_id: 'MANUAL',
        version: 1,
        conditions: [],
        match: 'ALL',
        snapshot_at: new Date()
      },
      event_time: eventTimeResult.event_time,
      event_time_source: eventTimeResult.source,
      webhook_id: manualWebhookId,
      fingerprint: fingerprint,
      steps: playbookSteps.map(step => ({
        step_id: step.step_id,
        state: StepState.PENDING
      })),
      started_at: new Date()
    });

    await execution.save();

    // Execute asynchronously via the engine
    const { ExecutionEngine } = await import('../engine/execution-engine.js');
    const playbookForExecution = {
      playbook_id: playbookObj.playbook_id || playbook_id,
      name: playbookObj.name,
      description: playbookObj.description,
      shadow_mode: playbookObj.dsl?.shadow_mode || false,
      steps: playbookSteps,
      version: playbookObj.version,
      enabled: playbookObj.enabled
    };

    setImmediate(() => {
      const engine = new ExecutionEngine(execution, playbookForExecution);
      engine.execute().catch(error => {
        logger.error(`[ExecutionAPI] Manual execution failed: ${error.message}`);
      });
    });

    await logAction({
      action: 'execution.manual_trigger',
      resource_type: 'execution',
      resource_id: execution.execution_id,
      actor_email: userId,
      details: { playbook_id, bypass_trigger: !!bypass_trigger },
      outcome: 'success'
    });

    return res.status(202).json({
      status: 'accepted',
      execution_id: execution.execution_id,
      playbook_id: playbook_id,
      state: execution.state
    });

  } catch (error) {
    logger.error(`[ExecutionAPI] Failed to trigger execution: ${error.message}`);
    return res.status(500).json({ error: 'Failed to trigger execution' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

export default router;
