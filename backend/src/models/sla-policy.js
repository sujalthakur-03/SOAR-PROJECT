/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.x — SLA POLICY MODEL
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Defines configurable SLA policies for SOC operations.
 * SLA policies can be defined globally, per playbook, or per severity level.
 *
 * SLA DIMENSIONS:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. ACKNOWLEDGE_SLA - Time from webhook received to execution created (~30s)
 * 2. CONTAINMENT_SLA - Time from execution start to first containment action (~5m)
 * 3. RESOLUTION_SLA  - Time from execution start to terminal state (~30m)
 *
 * BREACH CLASSIFICATION:
 * ─────────────────────────────────────────────────────────────────────────────
 * - automation_failure: Playbook step failed, blocking progress
 * - external_dependency_delay: External API/service timeout or slowness
 * - manual_intervention_delay: Approval or manual step taking too long
 * - resource_exhaustion: System overload causing processing delays
 *
 * VERSION: 1.0.0
 * AUTHOR: SOC Metrics & SLA Architect
 * ══════════════════════════════════════════════════════════════════════════════
 */

import mongoose from 'mongoose';

// ═══════════════════════════════════════════════════════════════════════════════
// SLA SCOPE TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export const SLAScope = Object.freeze({
  GLOBAL: 'global',           // Default SLA for all executions
  PLAYBOOK: 'playbook',       // SLA specific to a playbook
  SEVERITY: 'severity'        // SLA specific to alert severity
});

// ═══════════════════════════════════════════════════════════════════════════════
// SEVERITY LEVELS
// ═══════════════════════════════════════════════════════════════════════════════

export const SeverityLevel = Object.freeze({
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low'
});

// ═══════════════════════════════════════════════════════════════════════════════
// SLA THRESHOLDS SUB-SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════

const SLAThresholdsSchema = new mongoose.Schema({
  // Time from webhook received to execution created (milliseconds)
  acknowledge_ms: {
    type: Number,
    required: true,
    default: 30000,  // 30 seconds
    min: 0
  },

  // Time from execution start to first containment action (milliseconds)
  containment_ms: {
    type: Number,
    required: true,
    default: 300000,  // 5 minutes
    min: 0
  },

  // Time from execution start to terminal state (milliseconds)
  resolution_ms: {
    type: Number,
    required: true,
    default: 1800000,  // 30 minutes
    min: 0
  }
}, { _id: false });

// ═══════════════════════════════════════════════════════════════════════════════
// SLA POLICY SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════

const SLAPolicySchema = new mongoose.Schema({
  // Policy identifier
  policy_id: {
    type: String,
    required: true,
    unique: true,
    index: true,
    validate: {
      validator: function(v) {
        return /^SLA-[A-Z0-9-]+$/.test(v);
      },
      message: 'policy_id must match format: SLA-XXXXXX'
    }
  },

  // Policy name
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },

  description: {
    type: String,
    trim: true,
    maxlength: 1000
  },

  // Scope of this SLA policy
  scope: {
    type: String,
    enum: Object.values(SLAScope),
    required: true,
    index: true
  },

  // For scope=playbook: playbook_id this applies to
  playbook_id: {
    type: String,
    index: true,
    validate: {
      validator: function(v) {
        return this.scope !== SLAScope.PLAYBOOK || !!v;
      },
      message: 'playbook_id required when scope is playbook'
    }
  },

  // For scope=severity: severity level this applies to
  severity: {
    type: String,
    enum: Object.values(SeverityLevel),
    index: true,
    validate: {
      validator: function(v) {
        return this.scope !== SLAScope.SEVERITY || !!v;
      },
      message: 'severity required when scope is severity'
    }
  },

  // SLA thresholds
  thresholds: {
    type: SLAThresholdsSchema,
    required: true
  },

  // Is this policy active?
  enabled: {
    type: Boolean,
    default: true,
    index: true
  },

  // Priority for policy selection (lower = higher priority)
  // Evaluation order: playbook-specific > severity-specific > global
  priority: {
    type: Number,
    default: 100,
    min: 1,
    max: 1000
  },

  // Metadata
  created_by: {
    type: String,
    required: true
  }

}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'sla_policies'
});

// ═══════════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════════

// Unique index for global policy (only one can be active)
SLAPolicySchema.index(
  { scope: 1, enabled: 1 },
  {
    unique: true,
    partialFilterExpression: { scope: SLAScope.GLOBAL, enabled: true },
    name: 'idx_unique_global_sla'
  }
);

// Unique index for playbook-specific policies
SLAPolicySchema.index(
  { scope: 1, playbook_id: 1, enabled: 1 },
  {
    unique: true,
    partialFilterExpression: { scope: SLAScope.PLAYBOOK, enabled: true },
    name: 'idx_unique_playbook_sla'
  }
);

// Unique index for severity-specific policies
SLAPolicySchema.index(
  { scope: 1, severity: 1, enabled: 1 },
  {
    unique: true,
    partialFilterExpression: { scope: SLAScope.SEVERITY, enabled: true },
    name: 'idx_unique_severity_sla'
  }
);

// Compound index for policy lookup
SLAPolicySchema.index({ enabled: 1, priority: 1 });

// ═══════════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a unique SLA policy ID
 */
SLAPolicySchema.statics.generatePolicyId = function(scope, identifier = '') {
  const timestamp = Date.now().toString(36).toUpperCase();
  const suffix = identifier ? identifier.replace(/[^A-Z0-9]/g, '').substring(0, 8) : scope.toUpperCase();
  return `SLA-${suffix}-${timestamp}`;
};

/**
 * Find the applicable SLA policy for an execution
 *
 * Priority order:
 * 1. Playbook-specific policy
 * 2. Severity-specific policy
 * 3. Global policy
 *
 * @param {string} playbookId - Playbook ID
 * @param {string} severity - Alert severity (critical, high, medium, low)
 * @returns {Promise<object|null>} - Applicable SLA policy or null
 */
SLAPolicySchema.statics.findApplicablePolicy = async function(playbookId, severity) {
  // Try playbook-specific policy first
  let policy = await this.findOne({
    scope: SLAScope.PLAYBOOK,
    playbook_id: playbookId,
    enabled: true
  });

  if (policy) return policy;

  // Try severity-specific policy
  if (severity) {
    policy = await this.findOne({
      scope: SLAScope.SEVERITY,
      severity: severity.toLowerCase(),
      enabled: true
    });

    if (policy) return policy;
  }

  // Fall back to global policy
  policy = await this.findOne({
    scope: SLAScope.GLOBAL,
    enabled: true
  });

  return policy;
};

/**
 * Get or create default global SLA policy
 */
SLAPolicySchema.statics.getOrCreateGlobalPolicy = async function() {
  let policy = await this.findOne({ scope: SLAScope.GLOBAL, enabled: true });

  if (!policy) {
    policy = new this({
      policy_id: this.generatePolicyId('GLOBAL', 'DEFAULT'),
      name: 'Default Global SLA Policy',
      description: 'Default SLA thresholds applied when no specific policy exists',
      scope: SLAScope.GLOBAL,
      thresholds: {
        acknowledge_ms: 30000,   // 30 seconds
        containment_ms: 300000,  // 5 minutes
        resolution_ms: 1800000   // 30 minutes
      },
      enabled: true,
      priority: 999,
      created_by: 'system'
    });

    await policy.save();
  }

  return policy;
};

// ═══════════════════════════════════════════════════════════════════════════════
// INSTANCE METHODS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check if a duration exceeds an SLA threshold
 */
SLAPolicySchema.methods.checkBreach = function(dimension, durationMs) {
  const threshold = this.thresholds[`${dimension}_ms`];
  return {
    breached: durationMs > threshold,
    threshold_ms: threshold,
    actual_ms: durationMs,
    overage_ms: Math.max(0, durationMs - threshold)
  };
};

/**
 * Export policy as a plain object
 */
SLAPolicySchema.methods.toSummary = function() {
  return {
    policy_id: this.policy_id,
    name: this.name,
    scope: this.scope,
    playbook_id: this.playbook_id,
    severity: this.severity,
    thresholds: this.thresholds,
    enabled: this.enabled
  };
};

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

const SLAPolicy = mongoose.model('SLAPolicy', SLAPolicySchema);

export default SLAPolicy;
export { SLAPolicySchema, SLAThresholdsSchema };
