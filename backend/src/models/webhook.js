/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.0 — WEBHOOK MODEL
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Manages webhook endpoints for playbook ingestion.
 * Each playbook gets exactly one webhook (1:1 relationship).
 *
 * WEBHOOK LIFECYCLE:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. CREATE  - Webhook created when playbook is created
 * 2. ROTATE  - Secret can be rotated without disabling webhook
 * 3. DISABLE - Webhook can be temporarily disabled
 * 4. DELETE  - Webhook deleted when playbook is deleted
 *
 * URL FORMAT:
 *   POST /api/webhooks/{webhook_id}
 *   Headers: X-Webhook-Secret: {secret}
 *
 * VERSION: 1.0.0
 * AUTHOR: CyberSentinel SOAR Team
 * ══════════════════════════════════════════════════════════════════════════════
 */

import mongoose from 'mongoose';
import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK STATUS
// ═══════════════════════════════════════════════════════════════════════════════

export const WebhookStatus = Object.freeze({
  ACTIVE: 'active',
  DISABLED: 'disabled',
  SUSPENDED: 'suspended'  // Auto-suspended due to errors
});

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════

const WebhookSchema = new mongoose.Schema({
  // ─────────────────────────────────────────────────────────────────────────────
  // IDENTIFIERS
  // ─────────────────────────────────────────────────────────────────────────────

  webhook_id: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true,
    validate: {
      validator: function(v) {
        return /^WH-[A-Z0-9]+$/.test(v);
      },
      message: 'webhook_id must match format: WH-XXXXXX'
    }
  },

  playbook_id: {
    type: String,
    required: [true, 'playbook_id is required'],
    unique: true,  // 1:1 binding
    index: true
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // HARDENING: trigger_id for bidirectional 1:1:1 cardinality lock
  // ═══════════════════════════════════════════════════════════════════════════════
  trigger_id: {
    type: String,
    unique: true,
    sparse: true,  // Allow null until trigger is created
    index: true
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // AUTHENTICATION
  // ─────────────────────────────────────────────────────────────────────────────

  // 32-byte hex secret for webhook authentication
  secret: {
    type: String,
    required: true,
    minlength: 64,
    maxlength: 64,
    select: false  // Don't return secret in queries by default
  },

  // Hash of secret for safe logging (first 8 chars)
  secret_prefix: {
    type: String,
    maxlength: 8
  },

  // Secret rotation tracking
  secret_rotated_at: {
    type: Date,
    default: Date.now
  },

  secret_rotation_count: {
    type: Number,
    default: 0
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // STATUS & LIFECYCLE
  // ─────────────────────────────────────────────────────────────────────────────

  status: {
    type: String,
    enum: Object.values(WebhookStatus),
    default: WebhookStatus.ACTIVE,
    index: true
  },

  enabled: {
    type: Boolean,
    default: true,
    index: true
  },

  // Auto-suspend after consecutive errors
  consecutive_errors: {
    type: Number,
    default: 0
  },

  max_consecutive_errors: {
    type: Number,
    default: 10  // Suspend after 10 consecutive errors
  },

  last_error: {
    message: String,
    code: String,
    timestamp: Date
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // RATE LIMITING
  // ─────────────────────────────────────────────────────────────────────────────

  rate_limit: {
    enabled: { type: Boolean, default: true },
    max_requests: { type: Number, default: 100 },  // Per time window
    time_window_seconds: { type: Number, default: 60 }  // 1 minute
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // HARDENING: Rate limit tracking (in-memory state)
  // ═══════════════════════════════════════════════════════════════════════════════
  rate_limit_state: {
    current_window_start: { type: Date, default: Date.now },
    current_window_count: { type: Number, default: 0 }
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // HARDENING: Abuse protection
  // ═══════════════════════════════════════════════════════════════════════════════
  abuse_protection: {
    sustained_abuse_threshold: { type: Number, default: 3 },  // Consecutive windows exceeding limit
    sustained_abuse_count: { type: Number, default: 0 },
    auto_disabled_at: { type: Date },
    auto_disabled_reason: { type: String }
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // STATISTICS
  // ─────────────────────────────────────────────────────────────────────────────

  stats: {
    total_requests: { type: Number, default: 0 },
    total_accepted: { type: Number, default: 0 },
    total_rejected: { type: Number, default: 0 },
    total_dropped: { type: Number, default: 0 },  // Dropped by trigger (no match)
    total_errors: { type: Number, default: 0 },

    last_request_at: { type: Date },
    last_accepted_at: { type: Date },
    last_rejected_at: { type: Date },

    avg_processing_ms: { type: Number, default: 0 }
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // METADATA
  // ─────────────────────────────────────────────────────────────────────────────

  created_by: {
    type: String,
    required: true
  },

  description: {
    type: String,
    maxlength: 500
  }

}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'webhooks'
});

// ═══════════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════════

// Compound index for active webhook lookup
WebhookSchema.index({ status: 1, enabled: 1 });
WebhookSchema.index({ playbook_id: 1, status: 1 });

// ═══════════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a unique webhook ID
 */
WebhookSchema.statics.generateWebhookId = function() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `WH-${timestamp}${random}`;
};

/**
 * Generate a new secret
 */
WebhookSchema.statics.generateSecret = function() {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Find active webhook by webhook_id
 */
WebhookSchema.statics.findActiveWebhook = function(webhookId) {
  return this.findOne({
    webhook_id: webhookId,
    enabled: true,
    status: WebhookStatus.ACTIVE
  }).select('+secret');  // Include secret for validation
};

/**
 * Find webhook by playbook_id
 */
WebhookSchema.statics.findByPlaybookId = function(playbookId) {
  return this.findOne({ playbook_id: playbookId });
};

/**
 * Create webhook for a playbook
 */
WebhookSchema.statics.createForPlaybook = async function(playbookId, createdBy) {
  const secret = this.generateSecret();

  const webhook = new this({
    webhook_id: this.generateWebhookId(),
    playbook_id: playbookId,
    secret: secret,
    secret_prefix: secret.substring(0, 8),
    created_by: createdBy
  });

  await webhook.save();
  return webhook;
};

// ═══════════════════════════════════════════════════════════════════════════════
// INSTANCE METHODS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate webhook secret
 */
WebhookSchema.methods.validateSecret = function(providedSecret) {
  // Constant-time comparison to prevent timing attacks
  if (!providedSecret || !this.secret) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(
      Buffer.from(providedSecret, 'utf8'),
      Buffer.from(this.secret, 'utf8')
    );
  } catch {
    return false;
  }
};

/**
 * Rotate webhook secret
 */
WebhookSchema.methods.rotateSecret = async function() {
  const newSecret = this.constructor.generateSecret();

  this.secret = newSecret;
  this.secret_prefix = newSecret.substring(0, 8);
  this.secret_rotated_at = new Date();
  this.secret_rotation_count++;

  await this.save();

  return newSecret;
};

// ═══════════════════════════════════════════════════════════════════════════════
// HARDENING: Rate limiting methods
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check if request is rate limited
 * Returns: { limited: boolean, remaining: number, reset_at: Date }
 */
WebhookSchema.methods.checkRateLimit = function() {
  if (!this.rate_limit.enabled) {
    return { limited: false, remaining: Infinity, reset_at: null };
  }

  const now = new Date();
  const windowStart = this.rate_limit_state.current_window_start || now;
  const windowMs = this.rate_limit.time_window_seconds * 1000;
  const windowEnd = new Date(windowStart.getTime() + windowMs);

  // Check if we're in a new window
  if (now >= windowEnd) {
    // New window - reset count
    this.rate_limit_state.current_window_start = now;
    this.rate_limit_state.current_window_count = 0;
    return {
      limited: false,
      remaining: this.rate_limit.max_requests,
      reset_at: new Date(now.getTime() + windowMs)
    };
  }

  // Current window - check count
  const remaining = this.rate_limit.max_requests - this.rate_limit_state.current_window_count;
  return {
    limited: remaining <= 0,
    remaining: Math.max(0, remaining),
    reset_at: windowEnd
  };
};

/**
 * Increment rate limit counter
 * Returns: { exceeded: boolean, abuse_detected: boolean }
 */
WebhookSchema.methods.incrementRateLimitCounter = async function() {
  const now = new Date();
  const windowStart = this.rate_limit_state.current_window_start || now;
  const windowMs = this.rate_limit.time_window_seconds * 1000;
  const windowEnd = new Date(windowStart.getTime() + windowMs);

  // Check if new window
  if (now >= windowEnd) {
    // Check if previous window was abusive
    if (this.rate_limit_state.current_window_count > this.rate_limit.max_requests) {
      this.abuse_protection.sustained_abuse_count++;
    } else {
      this.abuse_protection.sustained_abuse_count = 0;
    }

    // Reset window
    this.rate_limit_state.current_window_start = now;
    this.rate_limit_state.current_window_count = 1;
  } else {
    this.rate_limit_state.current_window_count++;
  }

  const exceeded = this.rate_limit_state.current_window_count > this.rate_limit.max_requests;
  const abuseDetected = this.abuse_protection.sustained_abuse_count >= this.abuse_protection.sustained_abuse_threshold;

  await this.save();

  return { exceeded, abuse_detected: abuseDetected };
};

/**
 * Auto-disable webhook due to sustained abuse
 */
WebhookSchema.methods.autoDisableForAbuse = async function(reason) {
  this.status = WebhookStatus.SUSPENDED;
  this.enabled = false;
  this.abuse_protection.auto_disabled_at = new Date();
  this.abuse_protection.auto_disabled_reason = reason;
  await this.save();
};

/**
 * Record a successful request
 */
WebhookSchema.methods.recordAccepted = async function(processingMs) {
  this.stats.total_requests++;
  this.stats.total_accepted++;
  this.stats.last_request_at = new Date();
  this.stats.last_accepted_at = new Date();
  this.consecutive_errors = 0;

  // Update running average
  const n = this.stats.total_requests;
  this.stats.avg_processing_ms =
    (this.stats.avg_processing_ms * (n - 1) + processingMs) / n;

  await this.save();
};

/**
 * Record a dropped request (trigger didn't match)
 */
WebhookSchema.methods.recordDropped = async function(processingMs) {
  this.stats.total_requests++;
  this.stats.total_dropped++;
  this.stats.last_request_at = new Date();
  this.consecutive_errors = 0;

  const n = this.stats.total_requests;
  this.stats.avg_processing_ms =
    (this.stats.avg_processing_ms * (n - 1) + processingMs) / n;

  await this.save();
};

/**
 * Record a rejected request (auth failure, validation failure)
 */
WebhookSchema.methods.recordRejected = async function(errorCode, errorMessage) {
  this.stats.total_requests++;
  this.stats.total_rejected++;
  this.stats.last_request_at = new Date();
  this.stats.last_rejected_at = new Date();

  await this.save();
};

/**
 * Record an error
 */
WebhookSchema.methods.recordError = async function(errorCode, errorMessage) {
  this.stats.total_requests++;
  this.stats.total_errors++;
  this.consecutive_errors++;

  this.last_error = {
    code: errorCode,
    message: errorMessage,
    timestamp: new Date()
  };

  // Auto-suspend after too many consecutive errors
  if (this.consecutive_errors >= this.max_consecutive_errors) {
    this.status = WebhookStatus.SUSPENDED;
  }

  await this.save();
};

/**
 * Re-enable a suspended webhook
 */
WebhookSchema.methods.reactivate = async function() {
  this.status = WebhookStatus.ACTIVE;
  this.enabled = true;
  this.consecutive_errors = 0;
  this.last_error = null;

  await this.save();
};

/**
 * Disable webhook
 */
WebhookSchema.methods.disable = async function() {
  this.enabled = false;
  this.status = WebhookStatus.DISABLED;
  await this.save();
};

/**
 * Enable webhook
 */
WebhookSchema.methods.enable = async function() {
  this.enabled = true;
  this.status = WebhookStatus.ACTIVE;
  this.consecutive_errors = 0;
  await this.save();
};

/**
 * Get webhook URL (without secret for display)
 */
WebhookSchema.methods.getUrl = function(baseUrl) {
  return `${baseUrl}/api/webhooks/${this.webhook_id}`;
};

/**
 * Get full webhook URL with secret (for configuration)
 */
WebhookSchema.methods.getFullUrl = function(baseUrl) {
  return `${baseUrl}/api/webhooks/${this.webhook_id}?secret=${this.secret}`;
};

// ═══════════════════════════════════════════════════════════════════════════════
// PRE-SAVE HOOKS
// ═══════════════════════════════════════════════════════════════════════════════

WebhookSchema.pre('save', function(next) {
  // Auto-generate webhook_id if not provided
  if (!this.webhook_id) {
    this.webhook_id = this.constructor.generateWebhookId();
  }

  // Auto-generate secret if not provided
  if (!this.secret) {
    const secret = this.constructor.generateSecret();
    this.secret = secret;
    this.secret_prefix = secret.substring(0, 8);
  }

  // Update secret_prefix if secret changed
  if (this.isModified('secret') && this.secret) {
    this.secret_prefix = this.secret.substring(0, 8);
  }

  next();
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

const Webhook = mongoose.model('Webhook', WebhookSchema);

export default Webhook;
export { WebhookSchema };
