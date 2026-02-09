/**
 * Execution Model
 * Stores playbook execution state with embedded trigger data (alert context)
 * This is the PRIMARY entity - alerts only exist as trigger_data within executions
 *
 * STATE VALUES (CANONICAL):
 *   - EXECUTING: Currently running
 *   - WAITING_APPROVAL: Paused waiting for approval
 *   - COMPLETED: Successfully finished
 *   - FAILED: Execution failed
 *
 * STEP STATE VALUES (CANONICAL):
 *   - PENDING: Not yet started
 *   - EXECUTING: Currently running
 *   - COMPLETED: Finished successfully
 *   - SKIPPED: Skipped (e.g., dry-run)
 *   - FAILED: Step failed
 */

import mongoose from 'mongoose';
import crypto from 'crypto';

/**
 * Generate a unique, human-readable execution ID
 * Format: EXE-YYYYMMDD-RANDOM (e.g., EXE-20260116-A1B2C3)
 */
function generateExecutionId() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateStr = `${year}${month}${day}`;
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `EXE-${dateStr}-${random}`;
}

// Valid execution states (CANONICAL - no other values allowed)
export const ExecutionState = {
  EXECUTING: 'EXECUTING',
  WAITING_APPROVAL: 'WAITING_APPROVAL',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED'
};

// Valid step states
export const StepState = {
  PENDING: 'PENDING',
  EXECUTING: 'EXECUTING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED'
};

const stepResultSchema = new mongoose.Schema({
  step_id: {
    type: String,
    required: true
  },
  state: {
    type: String,
    enum: Object.values(StepState),
    default: StepState.PENDING
  },
  started_at: Date,
  completed_at: Date,
  duration_ms: Number,
  output: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  error: {
    message: String,
    code: String,
    stack: String
  },
  retry_count: {
    type: Number,
    default: 0
  }
}, { _id: false });

const executionSchema = new mongoose.Schema({
  // Human-readable unique execution identifier (e.g., "EXE-20260116-A1B2C3")
  // This is the PRIMARY identifier for external use (NOT MongoDB _id)
  execution_id: {
    type: String,
    required: true,
    unique: true,
    index: true,
    default: generateExecutionId
  },

  // Logical playbook identifier (e.g., "PB-001")
  playbook_id: {
    type: String,
    required: true,
    index: true
  },
  playbook_name: {
    type: String,
    required: true
  },

  // Execution state - ONLY these values allowed
  state: {
    type: String,
    enum: Object.values(ExecutionState),
    default: ExecutionState.EXECUTING,
    required: true,
    index: true
  },

  // Embedded alert/event context - ALL context data lives here
  // This is the ONLY place alert data exists
  trigger_data: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    default: {}
  },

  // Trigger source - how this execution was initiated
  trigger_source: {
    type: String,
    enum: ['webhook', 'manual', 'simulation', 'api'],
    default: 'webhook',
    index: true
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // HARDENING: Trigger snapshot for audit trail
  // ═══════════════════════════════════════════════════════════════════════════════
  // Captures the EXACT trigger logic that fired this execution.
  // This allows auditing executions against the exact trigger version that matched.
  trigger_snapshot: {
    trigger_id: { type: String, required: true },
    version: { type: Number, required: true },
    conditions: [{
      field: { type: String, required: true },
      operator: { type: String, required: true },
      value: mongoose.Schema.Types.Mixed
    }],
    match: { type: String, enum: ['ALL', 'ANY'], required: true },
    snapshot_at: { type: Date, required: true, default: Date.now }
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // HARDENING: Normalized event time (ISO 8601)
  // ═══════════════════════════════════════════════════════════════════════════════
  // Single source of truth for event time, normalized from payload.
  // Used for fingerprint bucketing and execution metadata.
  event_time: {
    type: Date,
    required: true,
    index: true
  },
  event_time_source: {
    type: String,
    enum: ['payload.event_time', 'payload.timestamp', 'payload.@timestamp', 'arrival_time'],
    required: true
  },

  // Webhook and fingerprint metadata
  webhook_id: {
    type: String,
    required: true,
    index: true
  },
  fingerprint: {
    type: String,
    required: true,
    index: true
  },

  // Step execution results
  steps: [stepResultSchema],

  // Timing information
  started_at: Date,
  completed_at: Date,
  duration_ms: Number,

  // ═══════════════════════════════════════════════════════════════════════════
  // SOC METRICS & SLA TRACKING (Agent 13)
  // ═══════════════════════════════════════════════════════════════════════════

  // Webhook received timestamp (for MTTA calculation)
  webhook_received_at: {
    type: Date,
    required: true,
    default: Date.now,
    index: true
  },

  // Execution acknowledged timestamp (when execution record created)
  acknowledged_at: {
    type: Date,
    index: true
  },

  // First containment action timestamp
  containment_at: {
    type: Date,
    index: true
  },

  // SLA policy that applies to this execution
  sla_policy_id: {
    type: String,
    index: true
  },

  // SLA status tracking
  sla_status: {
    // MTTA: Mean Time To Acknowledge (webhook → execution created)
    acknowledge: {
      threshold_ms: Number,
      actual_ms: Number,
      breached: { type: Boolean, default: false }
    },

    // MTTC: Mean Time To Contain
    containment: {
      threshold_ms: Number,
      actual_ms: Number,
      breached: { type: Boolean, default: false }
    },

    // MTTR: Mean Time To Resolve
    resolution: {
      threshold_ms: Number,
      actual_ms: Number,
      breached: { type: Boolean, default: false }
    },

    // Breach classification (if any SLA breached)
    breach_reason: {
      type: String,
      enum: [
        'automation_failure',
        'external_dependency_delay',
        'manual_intervention_delay',
        'resource_exhaustion',
        null
      ],
      default: null
    }
  },

  // Drop reason (if execution was dropped before starting)
  drop_reason: {
    type: String,
    enum: [
      'matching_rules_not_satisfied',
      'schema_validation_failed',
      'duplicate_fingerprint',
      'playbook_disabled',
      'trigger_disabled',
      null
    ],
    default: null
  },

  // Error tracking
  error: {
    message: String,
    code: String,
    step_id: String,
    timestamp: Date
  },

  // Approval tracking (if execution requires approval)
  approval_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Approval'
  }
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE INDEXES
// ═══════════════════════════════════════════════════════════════════════════════
// These indexes support efficient querying for the SOC UI and observability

// Compound indexes for common queries (LEGACY - preserved for backward compatibility)
executionSchema.index({ playbook_id: 1, created_at: -1 });
executionSchema.index({ state: 1, created_at: -1 });
executionSchema.index({ started_at: -1 });

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT 8 OPTIMIZATION INDEXES
// ═══════════════════════════════════════════════════════════════════════════════
// Added to support execution-centric UI filtering and statistics

// State + event_time compound index for state filtering with time-based sorting
// Supports queries like: ?state=EXECUTING (sorted by event_time DESC)
executionSchema.index(
  { state: 1, event_time: -1 },
  { name: 'idx_state_event_time', background: true }
);

// Nested field index: trigger_data.severity
// Supports queries like: ?severity=critical
executionSchema.index(
  { 'trigger_data.severity': 1, event_time: -1 },
  { name: 'idx_severity_event_time', background: true }
);

// Nested field index: trigger_data.rule_id
// Supports queries like: ?rule_id=100002
executionSchema.index(
  { 'trigger_data.rule_id': 1, event_time: -1 },
  { name: 'idx_rule_id_event_time', background: true }
);

// Nested field index: trigger_snapshot.trigger_id
// Supports queries like: ?trigger_id=TRG-001
executionSchema.index(
  { 'trigger_snapshot.trigger_id': 1, event_time: -1 },
  { name: 'idx_trigger_id_event_time', background: true }
);

// Webhook + event_time compound index
// Supports queries filtering by webhook source
executionSchema.index(
  { webhook_id: 1, event_time: -1 },
  { name: 'idx_webhook_event_time', background: true }
);

// Event time index for range queries
// Supports queries like: ?from_time=X&to_time=Y
executionSchema.index(
  { event_time: -1 },
  { name: 'idx_event_time', background: true }
);

// Compound index for state-based stats queries
// Optimizes getExecutionStatsDetailed() aggregation
executionSchema.index(
  { state: 1, completed_at: -1 },
  { name: 'idx_state_completed_at', background: true }
);

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT 13: SOC METRICS & SLA INDEXES
// ═══════════════════════════════════════════════════════════════════════════════

// SLA breach detection index
// Supports queries for breached executions
executionSchema.index(
  { 'sla_status.acknowledge.breached': 1, webhook_received_at: -1 },
  { name: 'idx_sla_acknowledge_breach', background: true }
);

executionSchema.index(
  { 'sla_status.resolution.breached': 1, started_at: -1 },
  { name: 'idx_sla_resolution_breach', background: true }
);

// SLA policy tracking
executionSchema.index(
  { sla_policy_id: 1, completed_at: -1 },
  { name: 'idx_sla_policy', background: true }
);

// Webhook received time index (for MTTA calculation)
executionSchema.index(
  { webhook_received_at: -1 },
  { name: 'idx_webhook_received_at', background: true }
);

// Acknowledged time index (for MTTA calculation)
executionSchema.index(
  { acknowledged_at: -1 },
  { name: 'idx_acknowledged_at', background: true, sparse: true }
);

// Containment time index (for MTTC calculation)
executionSchema.index(
  { containment_at: -1 },
  { name: 'idx_containment_at', background: true, sparse: true }
);

// ═══════════════════════════════════════════════════════════════════════════════
// INDEX JUSTIFICATION
// ═══════════════════════════════════════════════════════════════════════════════
//
// 1. idx_state_event_time
//    - Query pattern: Filter by state (EXECUTING, COMPLETED, etc.) + sort by event_time
//    - UI use case: "Show me all active executions, most recent first"
//    - Performance: O(log n) lookup + sequential scan of matching docs
//
// 2. idx_severity_event_time
//    - Query pattern: Filter by nested trigger_data.severity + sort by event_time
//    - UI use case: "Show me all critical severity executions"
//    - Performance: Supports index scan on nested field
//
// 3. idx_rule_id_event_time
//    - Query pattern: Filter by nested trigger_data.rule_id + sort by event_time
//    - UI use case: "Show me all executions triggered by rule 100002"
//    - Performance: Avoids collection scan for nested field queries
//
// 4. idx_trigger_id_event_time
//    - Query pattern: Filter by trigger_snapshot.trigger_id + sort by event_time
//    - UI use case: "Show me all executions from trigger TRG-001"
//    - Performance: Supports audit trail queries
//
// 5. idx_webhook_event_time
//    - Query pattern: Filter by webhook_id + sort by event_time
//    - UI use case: "Show me all executions from a specific webhook"
//    - Performance: Useful for debugging webhook ingestion
//
// 6. idx_event_time
//    - Query pattern: Range queries on event_time (from_time, to_time)
//    - UI use case: "Show me executions in the last 4 hours"
//    - Performance: Supports efficient range scans
//
// 7. idx_state_completed_at
//    - Query pattern: Aggregation queries counting by state with time filter
//    - UI use case: Stats endpoint (completed_today, failed_today)
//    - Performance: Optimizes $match stages in aggregation pipeline
//
// ═══════════════════════════════════════════════════════════════════════════════

// Method to update step state
executionSchema.methods.updateStepState = function(stepId, stepState, output = {}, error = null) {
  const step = this.steps.find(s => s.step_id === stepId);
  if (step) {
    step.state = stepState;
    step.output = output;
    if (error) {
      step.error = error;
    }
    if (stepState === StepState.EXECUTING && !step.started_at) {
      step.started_at = new Date();
    }
    if (stepState === StepState.COMPLETED || stepState === StepState.FAILED) {
      step.completed_at = new Date();
      if (step.started_at) {
        step.duration_ms = step.completed_at - step.started_at;
      }
    }
  }
  return this.save();
};

// Method to mark execution as complete
executionSchema.methods.complete = function() {
  this.state = ExecutionState.COMPLETED;
  this.completed_at = new Date();
  if (this.started_at) {
    this.duration_ms = this.completed_at - this.started_at;
  }
  return this.save();
};

// Method to mark execution as failed
executionSchema.methods.fail = function(error, stepId = null) {
  this.state = ExecutionState.FAILED;
  this.completed_at = new Date();
  if (this.started_at) {
    this.duration_ms = this.completed_at - this.started_at;
  }
  this.error = {
    message: error.message,
    code: error.code || 'EXECUTION_FAILED',
    step_id: stepId,
    timestamp: new Date()
  };
  return this.save();
};

// Method to set waiting for approval
executionSchema.methods.waitForApproval = function(approvalId) {
  this.state = ExecutionState.WAITING_APPROVAL;
  this.approval_id = approvalId;
  return this.save();
};

const Execution = mongoose.model('Execution', executionSchema);

export default Execution;
