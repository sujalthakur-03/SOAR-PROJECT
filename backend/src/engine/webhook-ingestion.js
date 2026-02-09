/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.0 — WEBHOOK INGESTION ENGINE (HARDENED v1.1.0)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Handles incoming webhook requests, evaluates triggers, and bootstraps
 * playbook executions.
 *
 * HARDENING (v1.1.0):
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. DROP_REASON_ENUM - Canonical drop reasons, logged without raw payload
 * 2. EVENT_TIME_NORMALIZATION - Single normalized event_time (ISO 8601)
 * 3. FINGERPRINT_COLLISION_HARDENING - Includes condition-matched payload hash
 * 4. RATE_LIMITING - Per-webhook rate limiting with abuse auto-disable
 * 5. TRIGGER_SNAPSHOT - Execution embeds exact trigger version for audit
 *
 * INGESTION FLOW:
 * ─────────────────────────────────────────────────────────────────────────────
 * CyberSentinel Forwarder
 *         ↓
 * Webhook Endpoint → Validate Secret → Check Rate Limit → Check Abuse
 *         ↓
 * Event Time Normalization
 *         ↓
 * Fingerprint Check → Duplicate? → DROP (200 OK)
 *         ↓
 * Trigger Evaluation
 *         ↓
 * MATCH?
 *   ├─ NO  → DROP (200 OK, commit offset)
 *   └─ YES → Create Execution + Trigger Snapshot → Pass trigger_data → Engine
 *         ↓
 * Return 202 Accepted with execution_id
 *
 * IDEMPOTENCY (HARDENED):
 * ─────────────────────────────────────────────────────────────────────────────
 * Fingerprint = SHA256(webhook_id + rule.id + agent.id + event_time_bucket + matched_fields_hash)
 * Event time bucket = floor(normalized_event_time / 60s) * 60
 *
 * VERSION: 1.1.0 (HARDENED)
 * AUTHOR: CyberSentinel SOAR Team
 * ══════════════════════════════════════════════════════════════════════════════
 */

import crypto from 'crypto';
import Webhook, { WebhookStatus } from '../models/webhook.js';
import Trigger from '../models/trigger.js';
import Execution, { ExecutionState, StepState } from '../models/execution.js';
import PlaybookVersioned from '../models/playbook-v2.js';
import { evaluateTrigger, resolveFieldPathLegacy } from './trigger-engine.js';
import { logAction } from '../services/audit-service.js';
import { incrementMetric } from '../services/metrics-service.js';
import { applySLAPolicy } from '../services/sla-enforcement-service.js';
import logger from '../utils/logger.js';

// ═══════════════════════════════════════════════════════════════════════════════
// HARDENING: DROP REASON ENUM (CANONICAL)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Canonical drop reasons (INTERNAL ONLY)
 * Log ONLY the enum + metadata, NEVER log raw alert payloads
 */
export const DropReason = Object.freeze({
  NO_TRIGGER_MATCH: 'NO_TRIGGER_MATCH',           // Trigger conditions not satisfied
  DUPLICATE_FINGERPRINT: 'DUPLICATE_FINGERPRINT', // Idempotency filter caught duplicate
  WEBHOOK_DISABLED: 'WEBHOOK_DISABLED',           // Webhook is disabled
  TRIGGER_DISABLED: 'TRIGGER_DISABLED',           // Trigger is disabled
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',             // Payload not a valid JSON object
  RATE_LIMITED: 'RATE_LIMITED',                   // Request rate limit exceeded
  WEBHOOK_NOT_FOUND: 'WEBHOOK_NOT_FOUND',         // No webhook with this ID
  WEBHOOK_SUSPENDED: 'WEBHOOK_SUSPENDED',         // Webhook auto-suspended for abuse
  NO_TRIGGER_DEFINED: 'NO_TRIGGER_DEFINED',       // No trigger exists for webhook
  PLAYBOOK_INACTIVE: 'PLAYBOOK_INACTIVE'          // Playbook not active
});

// ═══════════════════════════════════════════════════════════════════════════════
// FINGERPRINT CACHE (In-Memory with TTL)
// ═══════════════════════════════════════════════════════════════════════════════

// Simple in-memory cache for fingerprints (TTL: 5 minutes)
const FINGERPRINT_CACHE = new Map();
const FINGERPRINT_TTL_MS = 5 * 60 * 1000;  // 5 minutes
const FINGERPRINT_BUCKET_SECONDS = 60;     // 1 minute bucket

// Clean up expired fingerprints periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of FINGERPRINT_CACHE.entries()) {
    if (now - timestamp > FINGERPRINT_TTL_MS) {
      FINGERPRINT_CACHE.delete(key);
    }
  }
}, 60000);  // Clean every minute

// ═══════════════════════════════════════════════════════════════════════════════
// HARDENING: EVENT TIME NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Event time sources in priority order
 */
export const EventTimeSource = Object.freeze({
  PAYLOAD_EVENT_TIME: 'payload.event_time',
  PAYLOAD_TIMESTAMP: 'payload.timestamp',
  PAYLOAD_AT_TIMESTAMP: 'payload.@timestamp',
  ARRIVAL_TIME: 'arrival_time'
});

/**
 * Normalize event time from alert payload (HARDENED)
 *
 * Preferred order:
 * 1. payload.event_time
 * 2. payload.timestamp
 * 3. payload["@timestamp"]
 * 4. arrival time (fallback with warning)
 *
 * @param {object} payload - Alert payload
 * @returns {{ event_time: Date, source: string, warning: string|null }}
 */
export function normalizeEventTime(payload) {
  const arrivalTime = new Date();

  // Try preferred sources in order
  const sources = [
    { path: 'event_time', source: EventTimeSource.PAYLOAD_EVENT_TIME },
    { path: 'timestamp', source: EventTimeSource.PAYLOAD_TIMESTAMP },
    { path: '@timestamp', source: EventTimeSource.PAYLOAD_AT_TIMESTAMP }
  ];

  for (const { path, source } of sources) {
    const value = resolveFieldPathLegacy(path, payload);
    if (value !== undefined && value !== null) {
      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) {
        return {
          event_time: parsed,
          source,
          warning: null
        };
      }
    }
  }

  // Fallback to arrival time WITH WARNING
  logger.warn('[WebhookIngestion] Using arrival time as fallback - no valid event_time in payload');
  return {
    event_time: arrivalTime,
    source: EventTimeSource.ARRIVAL_TIME,
    warning: 'No valid event_time found in payload, using arrival time'
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FINGERPRINT GENERATION (HARDENED)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a fingerprint for an alert to detect duplicates (HARDENED)
 *
 * HARDENING: Fingerprint now includes:
 * - webhook_id
 * - rule.id
 * - agent.id (if present)
 * - normalized event_time bucket (60s)
 * - hash of condition-matched payload subset
 *
 * This prevents:
 * - Retried webhook calls
 * - Forwarder restarts
 * - Network issues causing duplicate delivery
 * - FALSE DROPS: Different alerts in same time window with same rule/agent
 *
 * @param {string} webhookId - Webhook identifier
 * @param {object} alert - Alert object
 * @param {Date} normalizedEventTime - Normalized event time
 * @param {Array} conditionFields - Fields used in trigger conditions (optional)
 * @returns {string} - SHA256 fingerprint
 */
export function generateFingerprint(webhookId, alert, normalizedEventTime, conditionFields = []) {
  // Extract key fields for fingerprinting
  const ruleId = resolveFieldPathLegacy('rule.id', alert) || resolveFieldPathLegacy('id', alert) || 'unknown';
  const agentId = resolveFieldPathLegacy('agent.id', alert) || resolveFieldPathLegacy('agent_id', alert) || '';

  // Use normalized event time bucket (60 seconds)
  const eventTimeMs = normalizedEventTime instanceof Date
    ? normalizedEventTime.getTime()
    : Date.now();
  const timestampBucket = Math.floor(eventTimeMs / (FINGERPRINT_BUCKET_SECONDS * 1000)) * FINGERPRINT_BUCKET_SECONDS;

  // ═══════════════════════════════════════════════════════════════════════════
  // HARDENING: Hash condition-matched payload subset
  // ═══════════════════════════════════════════════════════════════════════════
  // This prevents false drops when similar alerts occur in the same time window
  // but differ meaningfully in fields the trigger conditions check.
  let conditionFieldsHash = '';
  if (conditionFields && conditionFields.length > 0) {
    const conditionValues = conditionFields
      .map(field => {
        const value = resolveFieldPathLegacy(field, alert);
        return value !== undefined ? JSON.stringify(value) : '';
      })
      .join('|');
    conditionFieldsHash = crypto.createHash('sha256')
      .update(conditionValues)
      .digest('hex')
      .substring(0, 16);  // Use first 16 chars for brevity
  }

  // Create fingerprint string
  const fingerprintInput = agentId
    ? `${webhookId}:${ruleId}:${agentId}:${timestampBucket}:${conditionFieldsHash}`
    : `${webhookId}:${ruleId}:${timestampBucket}:${conditionFieldsHash}`;

  // Hash it
  return crypto.createHash('sha256').update(fingerprintInput).digest('hex');
}

/**
 * Extract condition fields from trigger for fingerprint generation
 *
 * @param {object} trigger - Trigger document
 * @returns {string[]} - Array of field paths used in conditions
 */
export function extractConditionFields(trigger) {
  if (!trigger || !trigger.conditions) {
    return [];
  }
  return trigger.conditions.map(c => c.field);
}

/**
 * Check if fingerprint exists (duplicate alert)
 *
 * @param {string} fingerprint - Fingerprint to check
 * @returns {boolean} - True if duplicate
 */
export function isDuplicateFingerprint(fingerprint) {
  return FINGERPRINT_CACHE.has(fingerprint);
}

/**
 * Record a fingerprint
 *
 * @param {string} fingerprint - Fingerprint to record
 */
export function recordFingerprint(fingerprint) {
  FINGERPRINT_CACHE.set(fingerprint, Date.now());
}

// ═══════════════════════════════════════════════════════════════════════════════
// INGESTION RESULT
// ═══════════════════════════════════════════════════════════════════════════════

export class IngestionResult {
  constructor() {
    this.accepted = false;
    this.webhook_id = null;
    this.trigger_id = null;
    this.playbook_id = null;
    this.execution_id = null;
    this.decision = null;  // 'accepted', 'dropped', 'rejected', 'error'
    this.drop_reason = null;
    this.reject_reason = null;
    this.error = null;
    this.latency_ms = 0;
    this.http_status = 200;
  }

  static accepted(webhookId, triggerId, playbookId, executionId, latencyMs) {
    const result = new IngestionResult();
    result.accepted = true;
    result.webhook_id = webhookId;
    result.trigger_id = triggerId;
    result.playbook_id = playbookId;
    result.execution_id = executionId;
    result.decision = 'accepted';
    result.latency_ms = latencyMs;
    result.http_status = 202;  // Accepted
    return result;
  }

  static dropped(webhookId, triggerId, playbookId, reason, latencyMs) {
    const result = new IngestionResult();
    result.accepted = false;
    result.webhook_id = webhookId;
    result.trigger_id = triggerId;
    result.playbook_id = playbookId;
    result.decision = 'dropped';
    result.drop_reason = reason;
    result.latency_ms = latencyMs;
    result.http_status = 200;  // OK - alert received but filtered
    return result;
  }

  static rejected(webhookId, reason, latencyMs) {
    const result = new IngestionResult();
    result.accepted = false;
    result.webhook_id = webhookId;
    result.decision = 'rejected';
    result.reject_reason = reason;
    result.latency_ms = latencyMs;
    result.http_status = reason === 'UNAUTHORIZED' ? 401 :
                         reason === 'RATE_LIMITED' ? 429 :
                         reason === 'WEBHOOK_NOT_FOUND' ? 404 :
                         400;
    return result;
  }

  static error(webhookId, errorMessage, latencyMs) {
    const result = new IngestionResult();
    result.accepted = false;
    result.webhook_id = webhookId;
    result.decision = 'error';
    result.error = errorMessage;
    result.latency_ms = latencyMs;
    result.http_status = 500;
    return result;
  }

  toLogObject() {
    return {
      webhook_id: this.webhook_id,
      trigger_id: this.trigger_id,
      playbook_id: this.playbook_id,
      execution_id: this.execution_id,
      decision: this.decision,
      latency_ms: this.latency_ms
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN INGESTION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Process an incoming webhook request (HARDENED v1.1.0)
 *
 * This is the main entry point for all alert ingestion.
 *
 * HARDENING FEATURES:
 * - Rate limiting with abuse auto-disable
 * - Event time normalization
 * - Improved fingerprint collision prevention
 * - Trigger snapshot in execution for audit
 * - Canonical drop reason enum
 *
 * @param {string} webhookId - Webhook identifier from URL
 * @param {string} providedSecret - Secret from header or query param
 * @param {object} alertPayload - Alert JSON body
 * @returns {Promise<IngestionResult>}
 */
export async function processWebhookIngestion(webhookId, providedSecret, alertPayload) {
  const startTime = Date.now();

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1: Find and validate webhook
  // ─────────────────────────────────────────────────────────────────────────────

  let webhook;
  try {
    webhook = await Webhook.findActiveWebhook(webhookId);
  } catch (error) {
    logger.error(`[WebhookIngestion] Database error finding webhook: ${error.message}`);
    return IngestionResult.error(webhookId, 'DATABASE_ERROR', Date.now() - startTime);
  }

  if (!webhook) {
    // HARDENING: Log drop reason enum only, no payload
    logger.warn(`[WebhookIngestion] DROP: ${DropReason.WEBHOOK_NOT_FOUND}`, { webhook_id: webhookId });
    await incrementMetric('webhook_requests_rejected');
    return IngestionResult.rejected(webhookId, DropReason.WEBHOOK_NOT_FOUND, Date.now() - startTime);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 2: Check if webhook is suspended (abuse protection)
  // ─────────────────────────────────────────────────────────────────────────────

  if (webhook.status === WebhookStatus.SUSPENDED) {
    logger.warn(`[WebhookIngestion] DROP: ${DropReason.WEBHOOK_SUSPENDED}`, { webhook_id: webhookId });
    await incrementMetric('webhook_requests_rejected');
    return IngestionResult.rejected(webhookId, DropReason.WEBHOOK_SUSPENDED, Date.now() - startTime);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 3: Validate secret
  // ─────────────────────────────────────────────────────────────────────────────

  if (!webhook.validateSecret(providedSecret)) {
    logger.warn(`[WebhookIngestion] Invalid secret for webhook ${webhookId}`);
    await webhook.recordRejected('UNAUTHORIZED', 'Invalid secret');
    await incrementMetric('webhook_requests_rejected');

    await logAction({
      action: 'webhook.unauthorized',
      resource_type: 'webhook',
      resource_id: webhookId,
      details: { secret_prefix: providedSecret?.substring(0, 8) || 'none' },
      outcome: 'failure'
    });

    return IngestionResult.rejected(webhookId, 'UNAUTHORIZED', Date.now() - startTime);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HARDENING STEP 4: Rate limit check
  // ─────────────────────────────────────────────────────────────────────────────

  const rateLimitCheck = webhook.checkRateLimit();
  if (rateLimitCheck.limited) {
    logger.warn(`[WebhookIngestion] DROP: ${DropReason.RATE_LIMITED}`, {
      webhook_id: webhookId,
      remaining: rateLimitCheck.remaining,
      reset_at: rateLimitCheck.reset_at
    });

    await incrementMetric('webhook_requests_rate_limited');

    // Track sustained abuse
    const { exceeded, abuse_detected } = await webhook.incrementRateLimitCounter();
    if (abuse_detected) {
      await webhook.autoDisableForAbuse('Sustained rate limit abuse');

      await logAction({
        action: 'webhook.auto_disabled',
        resource_type: 'webhook',
        resource_id: webhookId,
        details: { reason: 'SUSTAINED_ABUSE' },
        outcome: 'success'
      });

      logger.warn(`[WebhookIngestion] Webhook auto-disabled for abuse: ${webhookId}`);
    }

    return IngestionResult.rejected(webhookId, DropReason.RATE_LIMITED, Date.now() - startTime);
  }

  // Increment rate limit counter for successful auth
  await webhook.incrementRateLimitCounter();

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 5: Validate payload
  // ─────────────────────────────────────────────────────────────────────────────

  if (!alertPayload || typeof alertPayload !== 'object') {
    logger.warn(`[WebhookIngestion] DROP: ${DropReason.INVALID_PAYLOAD}`, { webhook_id: webhookId });
    await webhook.recordRejected(DropReason.INVALID_PAYLOAD, 'Payload must be a JSON object');
    await incrementMetric('webhook_requests_rejected');
    return IngestionResult.rejected(webhookId, DropReason.INVALID_PAYLOAD, Date.now() - startTime);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HARDENING STEP 6: Event time normalization
  // ─────────────────────────────────────────────────────────────────────────────

  const eventTimeResult = normalizeEventTime(alertPayload);
  if (eventTimeResult.warning) {
    logger.warn(`[WebhookIngestion] Event time warning: ${eventTimeResult.warning}`, {
      webhook_id: webhookId,
      source: eventTimeResult.source
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 7: Find trigger (needed for fingerprint)
  // ─────────────────────────────────────────────────────────────────────────────

  let trigger;
  try {
    trigger = await Trigger.findByWebhookId(webhookId);
  } catch (error) {
    logger.error(`[WebhookIngestion] Database error finding trigger: ${error.message}`);
    await webhook.recordError('DATABASE_ERROR', error.message);
    return IngestionResult.error(webhookId, 'DATABASE_ERROR', Date.now() - startTime);
  }

  if (!trigger) {
    logger.warn(`[WebhookIngestion] DROP: ${DropReason.NO_TRIGGER_DEFINED}`, { webhook_id: webhookId });
    await webhook.recordDropped(Date.now() - startTime);
    await incrementMetric('webhook_requests_no_trigger');
    return IngestionResult.dropped(
      webhookId,
      null,
      webhook.playbook_id,
      DropReason.NO_TRIGGER_DEFINED,
      Date.now() - startTime
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HARDENING STEP 8: Check for duplicates with improved fingerprint
  // ─────────────────────────────────────────────────────────────────────────────

  const conditionFields = extractConditionFields(trigger);
  const fingerprint = generateFingerprint(
    webhookId,
    alertPayload,
    eventTimeResult.event_time,
    conditionFields
  );

  if (isDuplicateFingerprint(fingerprint)) {
    logger.info(`[WebhookIngestion] DROP: ${DropReason.DUPLICATE_FINGERPRINT}`, {
      webhook_id: webhookId,
      fingerprint_prefix: fingerprint.substring(0, 16)
    });
    await incrementMetric('webhook_requests_deduplicated');
    return IngestionResult.dropped(
      webhookId,
      trigger.trigger_id,
      webhook.playbook_id,
      DropReason.DUPLICATE_FINGERPRINT,
      Date.now() - startTime
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 9: Evaluate trigger conditions
  // ─────────────────────────────────────────────────────────────────────────────

  const evalResult = evaluateTrigger(trigger, alertPayload);

  // Update trigger stats
  evalResult.matched
    ? await trigger.recordMatch()
    : await trigger.recordDrop();

  if (!evalResult.matched) {
    // HARDENING: Log drop reason enum, not raw payload
    logger.info(`[WebhookIngestion] DROP: ${DropReason.NO_TRIGGER_MATCH}`, {
      webhook_id: webhookId,
      trigger_id: trigger.trigger_id,
      conditions_evaluated: evalResult.conditions_evaluated,
      conditions_matched: evalResult.conditions_matched,
      latency_ms: Date.now() - startTime
    });

    await webhook.recordDropped(Date.now() - startTime);
    await incrementMetric('webhook_requests_dropped');

    return IngestionResult.dropped(
      webhookId,
      trigger.trigger_id,
      trigger.playbook_id,
      DropReason.NO_TRIGGER_MATCH,
      Date.now() - startTime
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 10: Find playbook (OPTION A: Use playbook_id from trigger)
  // ─────────────────────────────────────────────────────────────────────────────
  // CRITICAL: Trigger owns the playbook reference - read directly from trigger.playbook_id
  // Use PlaybookVersioned.getActiveVersion() to get the currently enabled version

  let playbook;
  try {
    playbook = await PlaybookVersioned.getActiveVersion(trigger.playbook_id);
  } catch (error) {
    logger.error(`[WebhookIngestion] Database error finding playbook: ${error.message}`);
    await webhook.recordError('DATABASE_ERROR', error.message);
    return IngestionResult.error(webhookId, 'DATABASE_ERROR', Date.now() - startTime);
  }

  if (!playbook) {
    logger.warn(`[WebhookIngestion] DROP: ${DropReason.PLAYBOOK_INACTIVE}`, {
      webhook_id: webhookId,
      playbook_id: trigger.playbook_id,
      reason: 'No enabled version found for playbook'
    });
    await webhook.recordDropped(Date.now() - startTime);
    await incrementMetric('webhook_requests_playbook_inactive');
    return IngestionResult.dropped(
      webhookId,
      trigger.trigger_id,
      trigger.playbook_id,
      DropReason.PLAYBOOK_INACTIVE,
      Date.now() - startTime
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HARDENING STEP 11: Create trigger snapshot for audit
  // ─────────────────────────────────────────────────────────────────────────────

  const triggerSnapshot = trigger.createSnapshot();

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 12: Create execution (ATOMIC)
  // ─────────────────────────────────────────────────────────────────────────────

  let execution;
  try {
    // Record fingerprint BEFORE creating execution to prevent race conditions
    recordFingerprint(fingerprint);

    // Create execution with hardened metadata
    execution = await createHardenedExecution(
      playbook,
      alertPayload,
      webhookId,
      triggerSnapshot,
      eventTimeResult,
      fingerprint
    );

  } catch (error) {
    logger.error(`[WebhookIngestion] Failed to create execution: ${error.message}`);
    await webhook.recordError('EXECUTION_FAILED', error.message);
    await incrementMetric('webhook_requests_execution_failed');

    // RETRY ONCE on execution creation failure
    try {
      await new Promise(resolve => setTimeout(resolve, 100));  // Brief delay
      execution = await createHardenedExecution(
        playbook,
        alertPayload,
        webhookId,
        triggerSnapshot,
        eventTimeResult,
        fingerprint
      );
    } catch (retryError) {
      logger.error(`[WebhookIngestion] Retry failed: ${retryError.message}`);
      return IngestionResult.error(webhookId, 'EXECUTION_CREATION_FAILED', Date.now() - startTime);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 13: Success - record and return
  // ─────────────────────────────────────────────────────────────────────────────

  const latencyMs = Date.now() - startTime;

  await webhook.recordAccepted(latencyMs);
  await incrementMetric('webhook_requests_accepted');
  await incrementMetric('executions_triggered');

  // Audit log (no raw payload)
  await logAction({
    action: 'webhook.triggered',
    resource_type: 'webhook',
    resource_id: webhookId,
    details: {
      webhook_id: webhookId,
      trigger_id: trigger.trigger_id,
      trigger_version: trigger.version,
      playbook_id: trigger.playbook_id,
      execution_id: execution.execution_id,
      event_time: eventTimeResult.event_time.toISOString(),
      event_time_source: eventTimeResult.source,
      latency_ms: latencyMs,
      fingerprint_prefix: fingerprint.substring(0, 16)
    },
    outcome: 'success'
  });

  logger.info(`[WebhookIngestion] Execution created`, {
    webhook_id: webhookId,
    trigger_id: trigger.trigger_id,
    trigger_version: trigger.version,
    playbook_id: trigger.playbook_id,
    execution_id: execution.execution_id,
    latency_ms: latencyMs
  });

  return IngestionResult.accepted(
    webhookId,
    trigger.trigger_id,
    trigger.playbook_id,
    execution.execution_id,
    latencyMs
  );
}

/**
 * Create execution with hardened metadata (INTERNAL)
 *
 * Embeds trigger snapshot, normalized event time, and fingerprint
 * for full audit trail.
 *
 * OPTION A COMPLIANCE:
 * - playbook_id comes from trigger (not looked up)
 * - Uses PlaybookVersioned lean document for execution
 */
async function createHardenedExecution(playbook, alertPayload, webhookId, triggerSnapshot, eventTimeResult, fingerprint) {
  // PlaybookVersioned.getActiveVersion() returns a lean object, so access dsl.steps
  const playbookSteps = playbook.dsl?.steps || playbook.steps || [];

  // Track timing for SLA calculation
  const webhookReceivedAt = new Date();  // This is when webhook was received
  const acknowledgedAt = new Date();     // This is when execution record is created

  const execution = new Execution({
    playbook_id: playbook.playbook_id,
    playbook_name: playbook.name,
    state: ExecutionState.EXECUTING,
    trigger_data: alertPayload,
    trigger_snapshot: triggerSnapshot,
    event_time: eventTimeResult.event_time,
    event_time_source: eventTimeResult.source,
    webhook_id: webhookId,
    fingerprint: fingerprint,
    steps: playbookSteps.map(step => ({
      step_id: step.step_id,
      state: StepState.PENDING
    })),
    started_at: new Date(),
    // SOC Metrics & SLA Tracking (Agent 13)
    webhook_received_at: webhookReceivedAt,
    acknowledged_at: acknowledgedAt
  });

  await execution.save();

  // Apply SLA policy and calculate acknowledge SLA
  try {
    await applySLAPolicy(execution);
  } catch (error) {
    logger.error(`Failed to apply SLA policy to execution ${execution.execution_id}:`, error);
    // Don't fail execution creation if SLA policy fails
  }

  // Import and run execution engine
  const { ExecutionEngine } = await import('./execution-engine.js');

  // Convert PlaybookVersioned to execution-compatible format
  const playbookForExecution = {
    playbook_id: playbook.playbook_id,
    name: playbook.name,
    description: playbook.description,
    shadow_mode: playbook.dsl?.shadow_mode || false,
    steps: playbookSteps,
    version: playbook.version,
    enabled: playbook.enabled
  };

  const engine = new ExecutionEngine(execution, playbookForExecution);

  // Execute asynchronously
  setImmediate(() => {
    engine.execute().catch(error => {
      logger.error(`[createHardenedExecution] Execution failed: ${error.message}`);
    });
  });

  return execution;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK LIFECYCLE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create webhook and trigger for a playbook
 *
 * @param {string} playbookId - Playbook identifier
 * @param {object} triggerDefinition - Trigger conditions
 * @param {string} createdBy - User creating the webhook
 * @returns {Promise<{webhook: object, trigger: object}>}
 */
export async function createWebhookForPlaybook(playbookId, triggerDefinition, createdBy) {
  // Create webhook
  const webhook = await Webhook.createForPlaybook(playbookId, createdBy);

  // Create trigger
  const trigger = new Trigger({
    trigger_id: Trigger.generateTriggerId(playbookId),
    playbook_id: playbookId,
    webhook_id: webhook.webhook_id,
    name: triggerDefinition.name || `Trigger for ${playbookId}`,
    description: triggerDefinition.description,
    conditions: triggerDefinition.conditions,
    match: triggerDefinition.match || 'ALL',
    alert_categories: triggerDefinition.alert_categories || [],
    created_by: createdBy
  });

  await trigger.save();

  await logAction({
    action: 'webhook.created',
    resource_type: 'webhook',
    resource_id: webhook.webhook_id,
    details: {
      playbook_id: playbookId,
      trigger_id: trigger.trigger_id
    },
    actor_email: createdBy,
    outcome: 'success'
  });

  return { webhook, trigger };
}

/**
 * Delete webhook and trigger for a playbook
 *
 * @param {string} playbookId - Playbook identifier
 * @param {string} deletedBy - User deleting the webhook
 */
export async function deleteWebhookForPlaybook(playbookId, deletedBy) {
  const webhook = await Webhook.findByPlaybookId(playbookId);
  const trigger = await Trigger.findByPlaybookId(playbookId);

  if (webhook) {
    await Webhook.deleteOne({ _id: webhook._id });
  }

  if (trigger) {
    await Trigger.deleteOne({ _id: trigger._id });
  }

  await logAction({
    action: 'webhook.deleted',
    resource_type: 'webhook',
    resource_id: webhook?.webhook_id,
    details: {
      playbook_id: playbookId,
      trigger_id: trigger?.trigger_id
    },
    actor_email: deletedBy,
    outcome: 'success'
  });
}

/**
 * Get webhook info for a playbook
 *
 * @param {string} playbookId - Playbook identifier
 * @param {string} baseUrl - Base URL for webhook URL construction
 * @returns {Promise<object|null>}
 */
export async function getWebhookInfo(playbookId, baseUrl) {
  const webhook = await Webhook.findByPlaybookId(playbookId);
  const trigger = await Trigger.findByPlaybookId(playbookId);

  if (!webhook) {
    return null;
  }

  return {
    webhook_id: webhook.webhook_id,
    playbook_id: webhook.playbook_id,
    url: webhook.getUrl(baseUrl),
    status: webhook.status,
    enabled: webhook.enabled,
    secret_prefix: webhook.secret_prefix,
    secret_rotated_at: webhook.secret_rotated_at,
    stats: webhook.stats,
    trigger: trigger ? {
      trigger_id: trigger.trigger_id,
      name: trigger.name,
      conditions: trigger.conditions,
      match: trigger.match,
      enabled: trigger.enabled,
      stats: trigger.stats
    } : null,
    created_at: webhook.created_at
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

export default {
  // Main ingestion
  processWebhookIngestion,

  // HARDENING: Drop reason enum
  DropReason,

  // HARDENING: Event time normalization
  normalizeEventTime,
  EventTimeSource,

  // HARDENING: Fingerprint generation
  generateFingerprint,
  extractConditionFields,
  isDuplicateFingerprint,
  recordFingerprint,

  // Webhook lifecycle
  createWebhookForPlaybook,
  deleteWebhookForPlaybook,
  getWebhookInfo,

  // Result types
  IngestionResult
};
