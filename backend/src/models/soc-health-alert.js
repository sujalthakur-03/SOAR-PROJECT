/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.x — SOC HEALTH ALERT MODEL
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Stores INTERNAL system health alerts (NOT security alerts).
 * These alerts notify SOC operators about platform performance issues.
 *
 * ALERT TYPES:
 * ─────────────────────────────────────────────────────────────────────────────
 * - backlog_growing: Execution backlog growing faster than resolution rate
 * - sla_breach_spike: SLA breach rate exceeding threshold
 * - playbook_failure_spike: Playbook failure rate spike
 * - webhook_ingestion_drop: Webhook ingestion rate dropped significantly
 * - forwarder_silence: Forwarder heartbeat missed
 * - approval_queue_stale: Approvals pending beyond threshold
 *
 * VERSION: 1.0.0
 * AUTHOR: SOC Metrics & SLA Architect
 * ══════════════════════════════════════════════════════════════════════════════
 */

import mongoose from 'mongoose';

// ═══════════════════════════════════════════════════════════════════════════════
// ALERT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export const SOCHealthAlertType = Object.freeze({
  BACKLOG_GROWING: 'backlog_growing',
  SLA_BREACH_SPIKE: 'sla_breach_spike',
  PLAYBOOK_FAILURE_SPIKE: 'playbook_failure_spike',
  WEBHOOK_INGESTION_DROP: 'webhook_ingestion_drop',
  FORWARDER_SILENCE: 'forwarder_silence',
  APPROVAL_QUEUE_STALE: 'approval_queue_stale'
});

// ═══════════════════════════════════════════════════════════════════════════════
// SEVERITY LEVELS (for internal alerts)
// ═══════════════════════════════════════════════════════════════════════════════

export const AlertSeverity = Object.freeze({
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info'
});

// ═══════════════════════════════════════════════════════════════════════════════
// ALERT STATUS
// ═══════════════════════════════════════════════════════════════════════════════

export const AlertStatus = Object.freeze({
  ACTIVE: 'active',
  ACKNOWLEDGED: 'acknowledged',
  RESOLVED: 'resolved',
  SUPPRESSED: 'suppressed'
});

// ═══════════════════════════════════════════════════════════════════════════════
// SOC HEALTH ALERT SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════

const SOCHealthAlertSchema = new mongoose.Schema({
  // Alert identifier
  alert_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // Alert type
  type: {
    type: String,
    enum: Object.values(SOCHealthAlertType),
    required: true,
    index: true
  },

  // Severity
  severity: {
    type: String,
    enum: Object.values(AlertSeverity),
    required: true,
    index: true
  },

  // Alert status
  status: {
    type: String,
    enum: Object.values(AlertStatus),
    default: AlertStatus.ACTIVE,
    required: true,
    index: true
  },

  // Human-readable title
  title: {
    type: String,
    required: true,
    maxlength: 500
  },

  // Detailed message
  message: {
    type: String,
    required: true,
    maxlength: 2000
  },

  // Alert context (type-specific data)
  context: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // Related resource (optional)
  resource_type: {
    type: String,
    enum: ['playbook', 'webhook', 'execution', 'approval', 'trigger', 'system', null],
    default: null
  },

  resource_id: {
    type: String,
    index: true
  },

  // Metrics snapshot at time of alert
  metrics_snapshot: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // Acknowledgment tracking
  acknowledged_by: String,
  acknowledged_at: Date,
  acknowledgment_note: String,

  // Resolution tracking
  resolved_by: String,
  resolved_at: {
    type: Date,
    index: true
  },
  resolution_note: String,

  // Auto-resolution flag
  auto_resolved: {
    type: Boolean,
    default: false
  },

  // Suppression (for alerts that fire too frequently)
  suppressed_until: {
    type: Date,
    index: true
  },

  // Alert occurrence count (for recurring alerts)
  occurrence_count: {
    type: Number,
    default: 1,
    min: 1
  },

  last_occurrence_at: {
    type: Date,
    default: Date.now
  }

}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'soc_health_alerts'
});

// ═══════════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════════

// Compound index for active alerts
SOCHealthAlertSchema.index(
  { status: 1, severity: 1, created_at: -1 },
  { name: 'idx_active_alerts' }
);

// Index for alert type queries
SOCHealthAlertSchema.index(
  { type: 1, status: 1, created_at: -1 },
  { name: 'idx_type_status' }
);

// Index for resource-based queries
SOCHealthAlertSchema.index(
  { resource_type: 1, resource_id: 1, status: 1 },
  { name: 'idx_resource_alerts', sparse: true }
);

// Index for time-based queries
SOCHealthAlertSchema.index(
  { created_at: -1 },
  { name: 'idx_created_at' }
);

// Index for resolved alerts
SOCHealthAlertSchema.index(
  { resolved_at: -1 },
  { name: 'idx_resolved_at', sparse: true }
);

// ═══════════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a unique alert ID
 */
SOCHealthAlertSchema.statics.generateAlertId = function(type) {
  const timestamp = Date.now().toString(36).toUpperCase();
  const typePrefix = type.toUpperCase().replace(/_/g, '').substring(0, 6);
  return `ALERT-${typePrefix}-${timestamp}`;
};

/**
 * Create or increment a health alert
 * If a similar active alert exists, increment occurrence_count instead of creating new
 */
SOCHealthAlertSchema.statics.createOrIncrement = async function(alertData) {
  // Check for existing active alert of same type for same resource
  const existingAlert = await this.findOne({
    type: alertData.type,
    status: { $in: [AlertStatus.ACTIVE, AlertStatus.ACKNOWLEDGED] },
    resource_type: alertData.resource_type || null,
    resource_id: alertData.resource_id || null,
    created_at: { $gte: new Date(Date.now() - 3600000) } // Within last hour
  });

  if (existingAlert) {
    // Increment occurrence count
    existingAlert.occurrence_count++;
    existingAlert.last_occurrence_at = new Date();
    existingAlert.message = alertData.message; // Update with latest message
    existingAlert.context = alertData.context || existingAlert.context;
    existingAlert.metrics_snapshot = alertData.metrics_snapshot || existingAlert.metrics_snapshot;
    await existingAlert.save();
    return existingAlert;
  }

  // Create new alert
  const alert = new this({
    alert_id: this.generateAlertId(alertData.type),
    ...alertData
  });

  await alert.save();
  return alert;
};

/**
 * Get active alerts with optional filtering
 */
SOCHealthAlertSchema.statics.getActive = function(filters = {}) {
  const query = { status: { $in: [AlertStatus.ACTIVE, AlertStatus.ACKNOWLEDGED] } };

  if (filters.type) query.type = filters.type;
  if (filters.severity) query.severity = filters.severity;
  if (filters.resource_type) query.resource_type = filters.resource_type;
  if (filters.resource_id) query.resource_id = filters.resource_id;

  return this.find(query).sort({ severity: 1, created_at: -1 }).lean();
};

/**
 * Auto-resolve alerts based on condition
 */
SOCHealthAlertSchema.statics.autoResolveByType = async function(type, resourceId = null) {
  const query = {
    type,
    status: { $in: [AlertStatus.ACTIVE, AlertStatus.ACKNOWLEDGED] }
  };

  if (resourceId) {
    query.resource_id = resourceId;
  }

  const result = await this.updateMany(
    query,
    {
      $set: {
        status: AlertStatus.RESOLVED,
        auto_resolved: true,
        resolved_at: new Date(),
        resolution_note: 'Auto-resolved: condition cleared'
      }
    }
  );

  return result.modifiedCount;
};

// ═══════════════════════════════════════════════════════════════════════════════
// INSTANCE METHODS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Acknowledge this alert
 */
SOCHealthAlertSchema.methods.acknowledge = function(userId, note = '') {
  this.status = AlertStatus.ACKNOWLEDGED;
  this.acknowledged_by = userId;
  this.acknowledged_at = new Date();
  this.acknowledgment_note = note;
  return this.save();
};

/**
 * Resolve this alert
 */
SOCHealthAlertSchema.methods.resolve = function(userId, note = '') {
  this.status = AlertStatus.RESOLVED;
  this.resolved_by = userId;
  this.resolved_at = new Date();
  this.resolution_note = note;
  return this.save();
};

/**
 * Suppress this alert for a duration
 */
SOCHealthAlertSchema.methods.suppress = function(durationMs) {
  this.status = AlertStatus.SUPPRESSED;
  this.suppressed_until = new Date(Date.now() + durationMs);
  return this.save();
};

/**
 * Check if alert is suppressed
 */
SOCHealthAlertSchema.methods.isSuppressed = function() {
  return this.status === AlertStatus.SUPPRESSED &&
         this.suppressed_until &&
         new Date() < this.suppressed_until;
};

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

const SOCHealthAlert = mongoose.model('SOCHealthAlert', SOCHealthAlertSchema);

export default SOCHealthAlert;
export { SOCHealthAlertSchema };
