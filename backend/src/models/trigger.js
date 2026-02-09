/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.0 — TRIGGER MODEL (HARDENED v1.1.0)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Defines trigger conditions that determine when a playbook should execute.
 *
 * HARDENING (v1.1.0):
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. IMMUTABLE VERSIONING - Triggers are versioned; updates create new versions
 * 2. STRICT 1:1:1 CARDINALITY - webhook_id is unique (one trigger per webhook)
 * 3. is_active flag - Only one version per trigger_id can be active
 * 4. trigger_snapshot - Conditions are snapshotted in executions for audit
 *
 * SUPPORTED ALERT FIELDS (CyberSentinel Schema):
 * ─────────────────────────────────────────────────────────────────────────────
 * rule.id                 - Unique rule identifier (e.g., "5710", "120000")
 * rule.level              - Rule severity level (1-15)
 * rule.groups[]           - Rule categories (e.g., ["authentication", "sshd"])
 * rule.mitre.id           - MITRE ATT&CK technique ID
 * rule.mitre.tactic       - MITRE ATT&CK tactic
 * rule.mitre.technique    - MITRE ATT&CK technique name
 * rule.description        - Rule description text
 *
 * agent.id                - Agent unique identifier
 * agent.name              - Agent hostname
 * agent.ip                - Agent IP address
 *
 * data.srcip              - Source IP address
 * data.dstip              - Destination IP address
 * data.srcport            - Source port
 * data.dstport            - Destination port
 * data.srcuser            - Source username
 * data.dstuser            - Destination username
 * data.protocol           - Network protocol
 * data.action             - Action taken (e.g., "blocked", "allowed")
 * data.status             - Status (e.g., "success", "failure")
 * data.win.system.eventID - Windows Event ID
 * data.win.system.channel - Windows Event Log channel
 *
 * decoder.name            - Decoder that processed the log
 * location                - Log source location/path
 * timestamp               - Event timestamp
 *
 * VERSION: 1.1.0 (HARDENED)
 * AUTHOR: CyberSentinel SOAR Team
 * ══════════════════════════════════════════════════════════════════════════════
 */

import mongoose from 'mongoose';

// ═══════════════════════════════════════════════════════════════════════════════
// CANONICAL TRIGGER OPERATORS
// ═══════════════════════════════════════════════════════════════════════════════

export const TriggerOperator = Object.freeze({
  // Equality
  EQUALS: 'equals',
  NOT_EQUALS: 'not_equals',

  // Numeric comparison
  GREATER_THAN: 'gt',
  GREATER_OR_EQUAL: 'gte',
  LESS_THAN: 'lt',
  LESS_OR_EQUAL: 'lte',

  // String operations
  CONTAINS: 'contains',
  NOT_CONTAINS: 'not_contains',
  STARTS_WITH: 'starts_with',
  ENDS_WITH: 'ends_with',

  // Array operations
  IN: 'in',
  NOT_IN: 'not_in',
  ARRAY_CONTAINS: 'array_contains',
  ARRAY_CONTAINS_ANY: 'array_contains_any',

  // Existence
  EXISTS: 'exists',
  NOT_EXISTS: 'not_exists'
});

export const VALID_OPERATORS = Object.values(TriggerOperator);

// ═══════════════════════════════════════════════════════════════════════════════
// CANONICAL MATCH MODES
// ═══════════════════════════════════════════════════════════════════════════════

export const MatchMode = Object.freeze({
  ALL: 'ALL',  // All conditions must match (AND)
  ANY: 'ANY'   // At least one condition must match (OR)
});

// ═══════════════════════════════════════════════════════════════════════════════
// TRIGGER CONDITION SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════

const TriggerConditionSchema = new mongoose.Schema({
  field: {
    type: String,
    required: [true, 'Condition field is required'],
    trim: true,
    validate: {
      validator: function(v) {
        // Valid field paths: alphanumeric with dots, brackets, underscores
        return /^[a-zA-Z_@][a-zA-Z0-9_]*(\.[a-zA-Z_@][a-zA-Z0-9_]*|\[\d+\])*$/.test(v);
      },
      message: props => `'${props.value}' is not a valid field path`
    }
  },
  operator: {
    type: String,
    required: [true, 'Condition operator is required'],
    enum: {
      values: VALID_OPERATORS,
      message: 'Invalid operator: {VALUE}'
    }
  },
  value: {
    type: mongoose.Schema.Types.Mixed,
    required: function() {
      // value not required for exists/not_exists operators
      return !['exists', 'not_exists'].includes(this.operator);
    }
  }
}, { _id: false });

// ═══════════════════════════════════════════════════════════════════════════════
// TRIGGER SCHEMA (HARDENED - IMMUTABLE VERSIONING)
// ═══════════════════════════════════════════════════════════════════════════════

const TriggerSchema = new mongoose.Schema({
  // ─────────────────────────────────────────────────────────────────────────────
  // IDENTIFIERS
  // ─────────────────────────────────────────────────────────────────────────────

  trigger_id: {
    type: String,
    required: true,
    trim: true,
    index: true,
    validate: {
      validator: function(v) {
        return /^TRG-[A-Z0-9-]+$/.test(v);
      },
      message: 'trigger_id must match format: TRG-XXXXXX'
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // HARDENING: Version number (auto-increment per trigger_id)
  // ═══════════════════════════════════════════════════════════════════════════
  version: {
    type: Number,
    required: true,
    default: 1,
    min: 1
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // HARDENING: is_active flag - only one version can be active per trigger_id
  // ═══════════════════════════════════════════════════════════════════════════
  is_active: {
    type: Boolean,
    required: true,
    default: true,
    index: true
  },

  playbook_id: {
    type: String,
    required: [true, 'playbook_id is required'],
    index: true
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // HARDENING: webhook_id MUST be unique (1:1:1 cardinality lock)
  // ═══════════════════════════════════════════════════════════════════════════
  webhook_id: {
    type: String,
    required: [true, 'webhook_id is required'],
    index: true
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // TRIGGER DEFINITION (IMMUTABLE once saved)
  // ─────────────────────────────────────────────────────────────────────────────

  name: {
    type: String,
    required: [true, 'Trigger name is required'],
    trim: true,
    maxlength: [200, 'Name cannot exceed 200 characters']
  },

  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },

  // Trigger conditions array (IMMUTABLE)
  conditions: {
    type: [TriggerConditionSchema],
    required: true,
    validate: {
      validator: function(v) {
        return v && v.length > 0;
      },
      message: 'At least one condition is required'
    }
  },

  // How to combine conditions: ALL (AND) or ANY (OR)
  match: {
    type: String,
    enum: Object.values(MatchMode),
    default: MatchMode.ALL,
    required: true
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // EXPECTED ALERT CATEGORIES (for documentation/filtering)
  // ─────────────────────────────────────────────────────────────────────────────

  alert_categories: {
    type: [String],
    enum: [
      'authentication',
      'network',
      'firewall',
      'windows',
      'linux',
      'ids',
      'dns',
      'web',
      'malware',
      'policy',
      'application_control',
      'file_integrity',
      'vulnerability',
      'compliance',
      'other'
    ],
    default: []
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // STATUS & LIFECYCLE
  // ─────────────────────────────────────────────────────────────────────────────

  enabled: {
    type: Boolean,
    default: true,
    index: true
  },

  // Priority for ordering when multiple triggers could match (lower = higher priority)
  priority: {
    type: Number,
    default: 100,
    min: 1,
    max: 1000
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // STATISTICS (updated by trigger engine)
  // ─────────────────────────────────────────────────────────────────────────────

  stats: {
    total_evaluations: { type: Number, default: 0 },
    total_matches: { type: Number, default: 0 },
    total_drops: { type: Number, default: 0 },
    last_matched_at: { type: Date },
    last_dropped_at: { type: Date },
    avg_evaluation_ms: { type: Number, default: 0 }
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // METADATA
  // ─────────────────────────────────────────────────────────────────────────────

  created_by: {
    type: String,
    required: true
  },

  superseded_by: {
    type: String,  // trigger_id:version of the superseding trigger
    default: null
  },

  supersedes: {
    type: String,  // trigger_id:version of the superseded trigger
    default: null
  }

}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'triggers'
});

// ═══════════════════════════════════════════════════════════════════════════════
// INDEXES (HARDENED)
// ═══════════════════════════════════════════════════════════════════════════════

// Unique compound index: trigger_id + version (allows multiple versions)
TriggerSchema.index({ trigger_id: 1, version: 1 }, { unique: true });

// Only ONE active trigger per playbook_id (1:1 cardinality lock)
TriggerSchema.index(
  { playbook_id: 1, is_active: 1 },
  { unique: true, partialFilterExpression: { is_active: true } }
);

// Only ONE active trigger per webhook_id (1:1 cardinality lock)
TriggerSchema.index(
  { webhook_id: 1, is_active: 1 },
  { unique: true, partialFilterExpression: { is_active: true } }
);

// Compound index for enabled triggers lookup
TriggerSchema.index({ enabled: 1, is_active: 1, playbook_id: 1 });
TriggerSchema.index({ webhook_id: 1, enabled: 1, is_active: 1 });

// ═══════════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a unique trigger ID
 */
TriggerSchema.statics.generateTriggerId = function(playbookId) {
  const suffix = playbookId.replace('PB-', '').substring(0, 12).toUpperCase();
  return `TRG-${suffix}-${Date.now().toString(36).toUpperCase()}`;
};

/**
 * Find ACTIVE trigger by playbook_id
 */
TriggerSchema.statics.findByPlaybookId = function(playbookId) {
  return this.findOne({ playbook_id: playbookId, is_active: true });
};

/**
 * Find ACTIVE trigger by webhook_id
 */
TriggerSchema.statics.findByWebhookId = function(webhookId) {
  return this.findOne({ webhook_id: webhookId, enabled: true, is_active: true });
};

/**
 * Find all versions of a trigger
 */
TriggerSchema.statics.findAllVersions = function(triggerId) {
  return this.find({ trigger_id: triggerId }).sort({ version: -1 });
};

/**
 * Find specific version of a trigger
 */
TriggerSchema.statics.findVersion = function(triggerId, version) {
  return this.findOne({ trigger_id: triggerId, version: version });
};

/**
 * Get next version number for a trigger_id
 */
TriggerSchema.statics.getNextVersion = async function(triggerId) {
  const latest = await this.findOne({ trigger_id: triggerId }).sort({ version: -1 });
  return latest ? latest.version + 1 : 1;
};

/**
 * Create a new version of an existing trigger (IMMUTABLE UPDATE)
 *
 * @param {string} triggerId - Trigger to update
 * @param {object} updates - New trigger definition
 * @param {string} updatedBy - User making the update
 * @returns {Promise<object>} - New trigger version
 */
TriggerSchema.statics.createNewVersion = async function(triggerId, updates, updatedBy) {
  const currentTrigger = await this.findOne({ trigger_id: triggerId, is_active: true });

  if (!currentTrigger) {
    throw new Error(`Active trigger not found: ${triggerId}`);
  }

  const nextVersion = await this.getNextVersion(triggerId);

  // Deactivate current version
  currentTrigger.is_active = false;
  currentTrigger.superseded_by = `${triggerId}:${nextVersion}`;
  await currentTrigger.save();

  // Create new version
  const newTrigger = new this({
    trigger_id: triggerId,
    version: nextVersion,
    is_active: true,
    playbook_id: currentTrigger.playbook_id,
    webhook_id: currentTrigger.webhook_id,
    name: updates.name || currentTrigger.name,
    description: updates.description !== undefined ? updates.description : currentTrigger.description,
    conditions: updates.conditions || currentTrigger.conditions,
    match: updates.match || currentTrigger.match,
    alert_categories: updates.alert_categories || currentTrigger.alert_categories,
    enabled: updates.enabled !== undefined ? updates.enabled : currentTrigger.enabled,
    priority: updates.priority || currentTrigger.priority,
    created_by: updatedBy,
    supersedes: `${triggerId}:${currentTrigger.version}`
  });

  await newTrigger.save();
  return newTrigger;
};

// ═══════════════════════════════════════════════════════════════════════════════
// INSTANCE METHODS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a trigger snapshot for embedding in executions
 * This captures the EXACT trigger logic at execution time for audit
 */
TriggerSchema.methods.createSnapshot = function() {
  return {
    trigger_id: this.trigger_id,
    version: this.version,
    conditions: this.conditions.map(c => ({
      field: c.field,
      operator: c.operator,
      value: c.value
    })),
    match: this.match,
    snapshot_at: new Date()
  };
};

/**
 * Record a match event
 */
TriggerSchema.methods.recordMatch = async function() {
  this.stats.total_evaluations++;
  this.stats.total_matches++;
  this.stats.last_matched_at = new Date();
  await this.save();
};

/**
 * Record a drop event
 */
TriggerSchema.methods.recordDrop = async function() {
  this.stats.total_evaluations++;
  this.stats.total_drops++;
  this.stats.last_dropped_at = new Date();
  await this.save();
};

/**
 * Update average evaluation time
 */
TriggerSchema.methods.updateAvgEvaluationTime = function(durationMs) {
  const n = this.stats.total_evaluations;
  if (n === 0) {
    this.stats.avg_evaluation_ms = durationMs;
  } else {
    // Running average
    this.stats.avg_evaluation_ms = (this.stats.avg_evaluation_ms * n + durationMs) / (n + 1);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PRE-SAVE HOOKS
// ═══════════════════════════════════════════════════════════════════════════════

TriggerSchema.pre('save', async function(next) {
  // Auto-generate trigger_id if not provided (only on new documents)
  if (this.isNew && !this.trigger_id) {
    this.trigger_id = this.constructor.generateTriggerId(this.playbook_id);
  }

  // Ensure version is set on new documents
  if (this.isNew && !this.version) {
    this.version = 1;
  }

  // HARDENING: Prevent modification of immutable fields on existing documents
  if (!this.isNew) {
    const immutableFields = ['trigger_id', 'version', 'conditions', 'match', 'playbook_id', 'webhook_id'];
    const modifiedPaths = this.modifiedPaths();

    for (const field of immutableFields) {
      if (modifiedPaths.includes(field)) {
        // Only allow modification of conditions if creating new version
        if (field === 'conditions' || field === 'match') {
          return next(new Error(`Cannot modify ${field}. Use createNewVersion() instead.`));
        }
      }
    }
  }

  next();
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

const Trigger = mongoose.model('Trigger', TriggerSchema);

export default Trigger;
export { TriggerSchema, TriggerConditionSchema };
