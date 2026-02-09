/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.0 — WEBHOOK MANAGEMENT API
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Production-grade Webhook Lifecycle API for playbook-bound webhooks.
 *
 * ENDPOINTS:
 * ─────────────────────────────────────────────────────────────────────────────
 * CREATE:
 *   POST   /api/playbooks/:playbook_id/webhook     - Create webhook for playbook
 *
 * READ:
 *   GET    /api/playbooks/:playbook_id/webhook     - Get webhook for playbook
 *
 * ROTATE:
 *   POST   /api/webhooks/:webhook_id/rotate        - Rotate webhook secret
 *
 * DISABLE:
 *   PATCH  /api/webhooks/:webhook_id/disable       - Disable webhook (soft delete)
 *
 * INGESTION:
 *   POST   /api/webhooks/:webhook_id/:secret       - Webhook ingestion endpoint
 *
 * ARCHITECTURE:
 * ─────────────────────────────────────────────────────────────────────────────
 * - Option A: Webhooks belong to playbooks (1:1 binding)
 * - Playbooks do NOT reference triggers
 * - Webhooks are first-class database objects
 * - Secrets are cryptographically secure (32 bytes / 64 hex chars)
 * - Secrets are NEVER logged
 *
 * VERSION: 1.0.0
 * AUTHOR: CyberSentinel SOAR Team
 * ══════════════════════════════════════════════════════════════════════════════
 */

import express from 'express';
import crypto from 'crypto';
import Webhook from '../models/webhook.js';
import Trigger from '../models/trigger.js';
import Playbook from '../models/playbook.js';
import PlaybookVersioned from '../models/playbook-v2.js';
import Execution, { ExecutionState, StepState } from '../models/execution.js';
import { logAction } from '../services/audit-service.js';
import { incrementMetric } from '../services/metrics-service.js';
import {
  normalizeEventTime,
  generateFingerprint,
  extractConditionFields
} from '../engine/webhook-ingestion.js';
import { validateHMACIfPresent, checkFloodControl } from '../middleware/webhook-security.js';
import logger from '../utils/logger.js';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Get base URL from request
// ═══════════════════════════════════════════════════════════════════════════════

function getBaseUrl(req) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${protocol}://${host}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Find playbook by ID (supports both playbook_id and MongoDB _id)
// ═══════════════════════════════════════════════════════════════════════════════

async function findPlaybook(playbookId) {
  // Try playbook_id first
  let playbook = await Playbook.findOne({ playbook_id: playbookId });

  // Fall back to MongoDB _id
  if (!playbook) {
    try {
      playbook = await Playbook.findById(playbookId);
    } catch (e) {
      // Invalid ObjectId format, ignore
    }
  }

  // Also check PlaybookVersioned (Agent 9 versioned playbooks)
  if (!playbook) {
    const versioned = await PlaybookVersioned.findOne({ playbook_id: playbookId, enabled: true });
    if (versioned) {
      return {
        playbook_id: versioned.playbook_id,
        name: versioned.name,
        _isVersioned: true
      };
    }
  }

  return playbook;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE WEBHOOK
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/playbooks/:playbook_id/webhook
 *
 * Create a webhook for a playbook.
 *
 * Behavior:
 * - Validate playbook exists
 * - Enforce 1 active webhook per playbook
 * - Generate webhook_id + secret
 * - Store in MongoDB
 * - Return full webhook URL with secret (only time secret is exposed)
 *
 * Response:
 * {
 *   "webhook_id": "WH-abc123",
 *   "playbook_id": "PB-001",
 *   "secret": "secureRandomSecret",
 *   "url": "http://<host>:3001/api/webhooks/WH-abc123/secureRandomSecret"
 * }
 */
router.post('/playbooks/:playbook_id/webhook', async (req, res) => {
  const { playbook_id } = req.params;
  const userId = req.user?.email || req.body.created_by || 'system';

  try {
    // STEP 1: Validate playbook exists
    const playbook = await findPlaybook(playbook_id);

    if (!playbook) {
      logger.warn(`[WebhookMgmt] Playbook not found: ${playbook_id}`);
      return res.status(404).json({
        error: 'Playbook not found',
        message: `No playbook exists with ID: ${playbook_id}`
      });
    }

    const playbookIdToUse = playbook.playbook_id || playbook_id;

    // STEP 2: Check if webhook already exists (enforce 1 per playbook)
    const existingWebhook = await Webhook.findByPlaybookId(playbookIdToUse);

    if (existingWebhook) {
      logger.warn(`[WebhookMgmt] Webhook already exists for playbook: ${playbookIdToUse}`);
      return res.status(409).json({
        error: 'Webhook already exists',
        message: 'This playbook already has an active webhook. Use rotate to get a new secret.',
        webhook_id: existingWebhook.webhook_id
      });
    }

    // STEP 3: Generate webhook_id and secret
    const webhookId = Webhook.generateWebhookId();
    const secret = Webhook.generateSecret();

    // STEP 4: Create webhook in MongoDB
    const webhook = new Webhook({
      webhook_id: webhookId,
      playbook_id: playbookIdToUse,
      secret: secret,
      secret_prefix: secret.substring(0, 8),
      created_by: userId,
      description: req.body.description || `Webhook for ${playbook.name || playbookIdToUse}`
    });

    await webhook.save();

    // STEP 5: Audit log
    await logAction({
      action: 'webhook.created',
      resource_type: 'webhook',
      resource_id: webhookId,
      resource_name: webhook.description,
      actor_email: userId,
      details: {
        playbook_id: playbookIdToUse,
        webhook_id: webhookId
      },
      outcome: 'success'
    });

    await incrementMetric('webhooks_created');

    logger.info(`[WebhookMgmt] Webhook created: ${webhookId} for playbook: ${playbookIdToUse}`);

    // STEP 6: Return response with full URL (secret only exposed on creation)
    const baseUrl = getBaseUrl(req);

    return res.status(201).json({
      webhook_id: webhookId,
      playbook_id: playbookIdToUse,
      secret: secret,
      url: `${baseUrl}/api/webhooks/${webhookId}/${secret}`,
      enabled: webhook.enabled,
      created_at: webhook.created_at
    });

  } catch (error) {
    logger.error(`[WebhookMgmt] Failed to create webhook: ${error.message}`, { playbook_id });

    await logAction({
      action: 'webhook.created',
      resource_type: 'webhook',
      resource_id: playbook_id,
      actor_email: userId,
      outcome: 'failure',
      error_message: error.message
    });

    return res.status(500).json({
      error: 'Failed to create webhook',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET WEBHOOK
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/playbooks/:playbook_id/webhook
 *
 * Get webhook metadata for a playbook.
 * Does NOT return the secret (use rotate to get a new one).
 */
router.get('/playbooks/:playbook_id/webhook', async (req, res) => {
  const { playbook_id } = req.params;

  try {
    // Find playbook
    const playbook = await findPlaybook(playbook_id);

    if (!playbook) {
      return res.status(404).json({
        error: 'Playbook not found',
        message: `No playbook exists with ID: ${playbook_id}`
      });
    }

    const playbookIdToUse = playbook.playbook_id || playbook_id;

    // Find webhook
    const webhook = await Webhook.findByPlaybookId(playbookIdToUse);

    if (!webhook) {
      return res.status(404).json({
        error: 'Webhook not found',
        message: 'No webhook configured for this playbook. Create one with POST /api/playbooks/:playbook_id/webhook'
      });
    }

    const baseUrl = getBaseUrl(req);

    // Return metadata (NO secret)
    return res.json({
      webhook_id: webhook.webhook_id,
      playbook_id: webhook.playbook_id,
      url: `${baseUrl}/api/webhooks/${webhook.webhook_id}/<secret>`,
      enabled: webhook.enabled,
      status: webhook.status,
      secret_prefix: webhook.secret_prefix,
      secret_rotated_at: webhook.secret_rotated_at,
      rotation_count: webhook.secret_rotation_count,
      stats: {
        total_requests: webhook.stats.total_requests,
        total_accepted: webhook.stats.total_accepted,
        total_rejected: webhook.stats.total_rejected,
        total_dropped: webhook.stats.total_dropped,
        last_request_at: webhook.stats.last_request_at,
        avg_processing_ms: webhook.stats.avg_processing_ms
      },
      rate_limit: {
        enabled: webhook.rate_limit.enabled,
        max_requests: webhook.rate_limit.max_requests,
        time_window_seconds: webhook.rate_limit.time_window_seconds
      },
      created_at: webhook.created_at,
      updated_at: webhook.updated_at
    });

  } catch (error) {
    logger.error(`[WebhookMgmt] Failed to get webhook: ${error.message}`, { playbook_id });
    return res.status(500).json({
      error: 'Failed to get webhook',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROTATE SECRET
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/webhooks/:webhook_id/rotate
 *
 * Rotate webhook secret.
 *
 * Behavior:
 * - Generate new secret
 * - Invalidate old secret immediately
 * - Update rotated_at timestamp
 * - Return new URL with new secret
 */
router.post('/webhooks/:webhook_id/rotate', async (req, res) => {
  const { webhook_id } = req.params;
  const userId = req.user?.email || req.body.rotated_by || 'system';

  try {
    // Find webhook (include secret field for rotation)
    const webhook = await Webhook.findOne({ webhook_id }).select('+secret');

    if (!webhook) {
      return res.status(404).json({
        error: 'Webhook not found',
        message: `No webhook exists with ID: ${webhook_id}`
      });
    }

    // Rotate the secret
    const newSecret = await webhook.rotateSecret();

    // Audit log
    await logAction({
      action: 'webhook.secret_rotated',
      resource_type: 'webhook',
      resource_id: webhook_id,
      actor_email: userId,
      details: {
        playbook_id: webhook.playbook_id,
        rotation_count: webhook.secret_rotation_count
      },
      outcome: 'success'
    });

    await incrementMetric('webhook_secrets_rotated');

    logger.info(`[WebhookMgmt] Secret rotated for webhook: ${webhook_id}`);

    const baseUrl = getBaseUrl(req);

    // Return new URL with new secret
    return res.json({
      webhook_id: webhook_id,
      playbook_id: webhook.playbook_id,
      secret: newSecret,
      url: `${baseUrl}/api/webhooks/${webhook_id}/${newSecret}`,
      secret_prefix: newSecret.substring(0, 8),
      rotated_at: webhook.secret_rotated_at,
      rotation_count: webhook.secret_rotation_count
    });

  } catch (error) {
    logger.error(`[WebhookMgmt] Failed to rotate secret: ${error.message}`, { webhook_id });

    await logAction({
      action: 'webhook.secret_rotated',
      resource_type: 'webhook',
      resource_id: webhook_id,
      outcome: 'failure',
      error_message: error.message
    });

    return res.status(500).json({
      error: 'Failed to rotate secret',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DISABLE WEBHOOK
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * PATCH /api/webhooks/:webhook_id/disable
 *
 * Disable a webhook (soft delete).
 *
 * Behavior:
 * - Set enabled = false
 * - Ingestion endpoint will reject disabled webhooks
 */
router.patch('/webhooks/:webhook_id/disable', async (req, res) => {
  const { webhook_id } = req.params;
  const userId = req.user?.email || req.body.disabled_by || 'system';

  try {
    const webhook = await Webhook.findOne({ webhook_id });

    if (!webhook) {
      return res.status(404).json({
        error: 'Webhook not found',
        message: `No webhook exists with ID: ${webhook_id}`
      });
    }

    // Disable the webhook
    await webhook.disable();

    // Audit log
    await logAction({
      action: 'webhook.disabled',
      resource_type: 'webhook',
      resource_id: webhook_id,
      actor_email: userId,
      details: {
        playbook_id: webhook.playbook_id
      },
      outcome: 'success'
    });

    await incrementMetric('webhooks_disabled');

    logger.info(`[WebhookMgmt] Webhook disabled: ${webhook_id}`);

    return res.json({
      webhook_id: webhook_id,
      playbook_id: webhook.playbook_id,
      enabled: false,
      status: webhook.status,
      disabled_at: new Date().toISOString()
    });

  } catch (error) {
    logger.error(`[WebhookMgmt] Failed to disable webhook: ${error.message}`, { webhook_id });

    await logAction({
      action: 'webhook.disabled',
      resource_type: 'webhook',
      resource_id: webhook_id,
      outcome: 'failure',
      error_message: error.message
    });

    return res.status(500).json({
      error: 'Failed to disable webhook',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ENABLE WEBHOOK (Bonus endpoint for completeness)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * PATCH /api/webhooks/:webhook_id/enable
 *
 * Re-enable a disabled webhook.
 */
router.patch('/webhooks/:webhook_id/enable', async (req, res) => {
  const { webhook_id } = req.params;
  const userId = req.user?.email || req.body.enabled_by || 'system';

  try {
    const webhook = await Webhook.findOne({ webhook_id });

    if (!webhook) {
      return res.status(404).json({
        error: 'Webhook not found',
        message: `No webhook exists with ID: ${webhook_id}`
      });
    }

    // Enable the webhook
    await webhook.enable();

    // Audit log
    await logAction({
      action: 'webhook.enabled',
      resource_type: 'webhook',
      resource_id: webhook_id,
      actor_email: userId,
      details: {
        playbook_id: webhook.playbook_id
      },
      outcome: 'success'
    });

    await incrementMetric('webhooks_enabled');

    logger.info(`[WebhookMgmt] Webhook enabled: ${webhook_id}`);

    return res.json({
      webhook_id: webhook_id,
      playbook_id: webhook.playbook_id,
      enabled: true,
      status: webhook.status,
      enabled_at: new Date().toISOString()
    });

  } catch (error) {
    logger.error(`[WebhookMgmt] Failed to enable webhook: ${error.message}`, { webhook_id });
    return res.status(500).json({
      error: 'Failed to enable webhook',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK INGESTION (SECRET IN URL PATH)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/webhooks/:webhook_id/:secret
 *
 * Main webhook ingestion endpoint with secret in URL path.
 *
 * This is the forwarder-compatible endpoint format:
 *   http://<SOAR_IP>:3001/api/webhooks/<webhook_id>/<secret>
 *
 * Validation order:
 * 1. Webhook exists
 * 2. Webhook enabled
 * 3. Secret matches (constant-time comparison)
 * 4. Rate limiting
 * 5. Payload validation
 * 6. Trigger evaluation (if trigger exists)
 * 7. Create execution
 *
 * Returns:
 *   202 - Execution created
 *   200 - Alert received but dropped (no trigger match)
 *   401 - Invalid secret
 *   403 - Webhook disabled
 *   404 - Webhook not found
 *   429 - Rate limited
 *   500 - Internal error
 */
router.post('/webhooks/:webhook_id/:secret', async (req, res) => {
  const { webhook_id, secret } = req.params;
  const startTime = Date.now();

  try {
    // STEP 1: Find webhook (include secret for validation)
    const webhook = await Webhook.findOne({ webhook_id }).select('+secret');

    if (!webhook) {
      logger.warn(`[WebhookIngestion] Webhook not found: ${webhook_id}`);
      await incrementMetric('webhook_requests_not_found');
      return res.status(404).json({
        error: 'Webhook not found',
        message: 'Invalid webhook URL'
      });
    }

    // STEP 2: Check if enabled
    if (!webhook.enabled) {
      logger.warn(`[WebhookIngestion] Webhook disabled: ${webhook_id}`);
      await webhook.recordRejected('DISABLED', 'Webhook is disabled');
      await incrementMetric('webhook_requests_disabled');
      return res.status(403).json({
        error: 'Webhook disabled',
        message: 'This webhook is currently disabled'
      });
    }

    // STEP 3: Validate secret (constant-time comparison)
    if (!webhook.validateSecret(secret)) {
      logger.warn(`[WebhookIngestion] Invalid secret for webhook: ${webhook_id}`);
      await webhook.recordRejected('UNAUTHORIZED', 'Invalid secret');
      await incrementMetric('webhook_requests_unauthorized');

      await logAction({
        action: 'webhook.unauthorized',
        resource_type: 'webhook',
        resource_id: webhook_id,
        details: { secret_prefix: secret?.substring(0, 8) || 'none' },
        outcome: 'failure'
      });

      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid webhook secret'
      });
    }

    // STEP 4: Rate limiting
    const rateLimitCheck = webhook.checkRateLimit();
    if (rateLimitCheck.limited) {
      logger.warn(`[WebhookIngestion] Rate limited: ${webhook_id}`);
      await incrementMetric('webhook_requests_rate_limited');

      const { abuse_detected } = await webhook.incrementRateLimitCounter();
      if (abuse_detected) {
        await webhook.autoDisableForAbuse('Sustained rate limit abuse');
        logger.warn(`[WebhookIngestion] Webhook auto-disabled for abuse: ${webhook_id}`);
      }

      return res.status(429).json({
        error: 'Rate limited',
        message: 'Too many requests',
        retry_after: Math.ceil((rateLimitCheck.reset_at - new Date()) / 1000)
      });
    }

    await webhook.incrementRateLimitCounter();

    // STEP 4b: HMAC signature verification (if header present)
    const hmacResult = validateHMACIfPresent(req, webhook.secret);
    if (!hmacResult.valid) {
      await webhook.recordRejected('HMAC_INVALID', hmacResult.error);
      return res.status(401).json({
        error: 'Unauthorized',
        message: hmacResult.error,
        code: hmacResult.code
      });
    }

    // STEP 4c: Execution flood control
    const floodResult = checkFloodControl(webhook.playbook_id);
    if (!floodResult.allowed) {
      await webhook.recordRejected('FLOOD_CONTROL', floodResult.message);
      return res.status(429).json({
        error: 'Flood Control',
        message: floodResult.message,
        code: floodResult.reason
      });
    }

    // STEP 5: Validate payload
    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      logger.warn(`[WebhookIngestion] Invalid payload for webhook: ${webhook_id}`);
      await webhook.recordRejected('INVALID_PAYLOAD', 'Payload must be JSON object');
      return res.status(400).json({
        error: 'Invalid payload',
        message: 'Request body must be a valid JSON object'
      });
    }

    // STEP 6: Find trigger (optional - if no trigger, create execution directly)
    const trigger = await Trigger.findByWebhookId(webhook_id);

    let matched = true;
    let dropReason = null;

    if (trigger && trigger.enabled) {
      // Import and evaluate trigger
      const { evaluateTrigger } = await import('../engine/trigger-engine.js');
      const evalResult = evaluateTrigger(trigger, payload);

      matched = evalResult.matched;
      dropReason = evalResult.drop_reason;

      // Update trigger stats
      matched ? await trigger.recordMatch() : await trigger.recordDrop();

      if (!matched) {
        const latencyMs = Date.now() - startTime;
        await webhook.recordDropped(latencyMs);
        await incrementMetric('webhook_requests_dropped');

        logger.info(`[WebhookIngestion] Alert dropped - no trigger match`, {
          webhook_id,
          trigger_id: trigger.trigger_id,
          latency_ms: latencyMs
        });

        return res.status(200).json({
          status: 'dropped',
          reason: 'NO_TRIGGER_MATCH',
          playbook_id: webhook.playbook_id,
          latency_ms: latencyMs
        });
      }
    }

    // STEP 7: Find playbook
    // IMPORTANT: Check PlaybookVersioned FIRST — it stores the full DSL (action_type, input,
    // condition, on_true, on_false) which the execution engine requires. The v1 Playbook model
    // has strict Mongoose schema that strips these fields. Fall back to v1 only if no versioned doc exists.
    let playbook = await PlaybookVersioned.getActiveVersion(webhook.playbook_id);

    // Fall back to v1 Playbook if no versioned document
    if (!playbook) {
      playbook = await Playbook.findOne({ playbook_id: webhook.playbook_id, status: 'active' });
    }

    if (!playbook) {
      logger.warn(`[WebhookIngestion] Playbook not active: ${webhook.playbook_id}`);
      const latencyMs = Date.now() - startTime;
      await webhook.recordDropped(latencyMs);

      return res.status(200).json({
        status: 'dropped',
        reason: 'PLAYBOOK_INACTIVE',
        playbook_id: webhook.playbook_id,
        latency_ms: latencyMs
      });
    }

    // STEP 8: Normalize event time and generate fingerprint
    const eventTimeResult = normalizeEventTime(payload);
    const conditionFields = trigger ? extractConditionFields(trigger) : [];
    const fingerprint = generateFingerprint(
      webhook_id,
      payload,
      eventTimeResult.event_time,
      conditionFields
    );

    // STEP 9: Create execution
    const playbookSteps = playbook.dsl?.steps || playbook.steps || [];

    // Create trigger snapshot (or default if no trigger)
    const triggerSnapshot = trigger ? trigger.createSnapshot() : {
      trigger_id: 'DIRECT',
      version: 1,
      conditions: [],
      match: 'ALL',
      snapshot_at: new Date()
    };

    const execution = new Execution({
      playbook_id: playbook.playbook_id,
      playbook_name: playbook.name,
      state: ExecutionState.EXECUTING,
      trigger_data: payload,
      webhook_id: webhook_id,
      trigger_snapshot: triggerSnapshot,
      event_time: eventTimeResult.event_time,
      event_time_source: eventTimeResult.source,
      fingerprint: fingerprint,
      steps: playbookSteps.map(step => ({
        step_id: step.step_id,
        state: StepState.PENDING
      })),
      started_at: new Date()
    });

    await execution.save();

    const latencyMs = Date.now() - startTime;
    await webhook.recordAccepted(latencyMs);
    await incrementMetric('webhook_requests_accepted');
    await incrementMetric('executions_created');

    // Audit log
    await logAction({
      action: 'webhook.triggered',
      resource_type: 'webhook',
      resource_id: webhook_id,
      details: {
        playbook_id: playbook.playbook_id,
        execution_id: execution.execution_id,
        trigger_id: trigger?.trigger_id,
        latency_ms: latencyMs
      },
      outcome: 'success'
    });

    logger.info(`[WebhookIngestion] Execution created: ${execution.execution_id}`, {
      webhook_id,
      playbook_id: playbook.playbook_id,
      latency_ms: latencyMs
    });

    // STEP 9: Start execution engine asynchronously
    setImmediate(async () => {
      try {
        const { ExecutionEngine } = await import('../engine/execution-engine.js');

        const playbookForExecution = {
          playbook_id: playbook.playbook_id,
          name: playbook.name,
          description: playbook.description,
          shadow_mode: playbook.dsl?.shadow_mode || playbook.shadow_mode || false,
          steps: playbookSteps,
          version: playbook.version,
          enabled: playbook.enabled ?? true
        };

        const engine = new ExecutionEngine(execution, playbookForExecution);
        await engine.execute();
      } catch (error) {
        logger.error(`[WebhookIngestion] Execution engine error: ${error.message}`, {
          execution_id: execution.execution_id
        });
      }
    });

    // Return 202 Accepted
    return res.status(202).json({
      status: 'accepted',
      execution_id: execution.execution_id,
      playbook_id: playbook.playbook_id,
      trigger_id: trigger?.trigger_id,
      latency_ms: latencyMs
    });

  } catch (error) {
    const latencyMs = Date.now() - startTime;
    logger.error(`[WebhookIngestion] Unhandled error: ${error.message}`, { webhook_id });

    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      latency_ms: latencyMs
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// LIST ALL WEBHOOKS (Admin endpoint)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/webhooks
 *
 * List all webhooks (admin use only).
 */
router.get('/webhooks', async (req, res) => {
  try {
    const { enabled, status, limit = 100, offset = 0 } = req.query;

    const query = {};
    if (enabled !== undefined) query.enabled = enabled === 'true';
    if (status) query.status = status;

    const webhooks = await Webhook.find(query)
      .sort({ created_at: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset))
      .lean();

    const total = await Webhook.countDocuments(query);

    const baseUrl = getBaseUrl(req);

    return res.json({
      data: webhooks.map(wh => ({
        webhook_id: wh.webhook_id,
        playbook_id: wh.playbook_id,
        url: `${baseUrl}/api/webhooks/${wh.webhook_id}/<secret>`,
        enabled: wh.enabled,
        status: wh.status,
        secret_prefix: wh.secret_prefix,
        stats: wh.stats,
        created_at: wh.created_at
      })),
      total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    logger.error(`[WebhookMgmt] Failed to list webhooks: ${error.message}`);
    return res.status(500).json({
      error: 'Failed to list webhooks',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE WEBHOOK
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * DELETE /api/webhooks/:webhook_id
 *
 * Permanently delete a webhook.
 */
router.delete('/webhooks/:webhook_id', async (req, res) => {
  const { webhook_id } = req.params;
  const userId = req.user?.email || 'system';

  try {
    const webhook = await Webhook.findOne({ webhook_id });

    if (!webhook) {
      return res.status(404).json({
        error: 'Webhook not found',
        message: `No webhook exists with ID: ${webhook_id}`
      });
    }

    const playbook_id = webhook.playbook_id;

    // Delete webhook
    await Webhook.deleteOne({ webhook_id });

    // Also delete associated trigger if exists
    await Trigger.deleteOne({ webhook_id });

    // Audit log
    await logAction({
      action: 'webhook.deleted',
      resource_type: 'webhook',
      resource_id: webhook_id,
      actor_email: userId,
      details: { playbook_id },
      outcome: 'success'
    });

    await incrementMetric('webhooks_deleted');

    logger.info(`[WebhookMgmt] Webhook deleted: ${webhook_id}`);

    return res.json({
      status: 'deleted',
      webhook_id: webhook_id,
      playbook_id: playbook_id
    });

  } catch (error) {
    logger.error(`[WebhookMgmt] Failed to delete webhook: ${error.message}`, { webhook_id });
    return res.status(500).json({
      error: 'Failed to delete webhook',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

export default router;
