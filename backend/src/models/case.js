/**
 * Case Model
 * SOC-grade case management for incident tracking and lifecycle management
 *
 * ARCHITECTURE RULES:
 * - Cases are DERIVED from Executions (not alerts)
 * - Each case links to one or more execution_ids
 * - Cases have their own lifecycle independent of executions
 * - Full audit trail via immutable timeline
 * - SLA tracking integrated with SOC metrics
 */

import mongoose from 'mongoose';
import crypto from 'crypto';

/**
 * Generate a unique, human-readable case ID
 * Format: CASE-YYYYMMDD-XXXX (e.g., CASE-20260123-A1B2)
 */
function generateCaseId() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateStr = `${year}${month}${day}`;
  const random = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `CASE-${dateStr}-${random}`;
}

// Valid case statuses with finite state machine
export const CaseStatus = {
  OPEN: 'OPEN',
  INVESTIGATING: 'INVESTIGATING',
  PENDING: 'PENDING',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED'
};

// Valid case severities
export const CaseSeverity = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW'
};

// Valid case priorities
export const CasePriority = {
  P1: 'P1',
  P2: 'P2',
  P3: 'P3',
  P4: 'P4'
};

// Timeline event schema (immutable audit trail)
const timelineEventSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    required: true,
    default: Date.now
  },
  event_type: {
    type: String,
    required: true,
    enum: [
      'case_created',
      'status_changed',
      'assigned',
      'execution_linked',
      'execution_unlinked',
      'comment_added',
      'evidence_added',
      'sla_breached',
      'case_escalated',
      'case_resolved',
      'case_closed',
      'case_reopened'
    ]
  },
  actor: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { _id: false });

// Evidence attachment schema
const evidenceSchema = new mongoose.Schema({
  evidence_id: {
    type: String,
    required: true,
    default: () => crypto.randomBytes(8).toString('hex')
  },
  type: {
    type: String,
    enum: ['file', 'url', 'hash', 'note', 'screenshot', 'log', 'other'],
    required: true
  },
  name: {
    type: String,
    required: true
  },
  description: String,
  content: {
    type: mongoose.Schema.Types.Mixed
  },
  added_by: {
    type: String,
    required: true
  },
  added_at: {
    type: Date,
    required: true,
    default: Date.now
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { _id: false });

// SLA deadline tracking
const slaDeadlineSchema = new mongoose.Schema({
  acknowledge: {
    deadline: Date,
    breached: { type: Boolean, default: false },
    breach_time: Date
  },
  investigate: {
    deadline: Date,
    breached: { type: Boolean, default: false },
    breach_time: Date
  },
  resolve: {
    deadline: Date,
    breached: { type: Boolean, default: false },
    breach_time: Date
  },
  close: {
    deadline: Date,
    breached: { type: Boolean, default: false },
    breach_time: Date
  }
}, { _id: false });

const caseSchema = new mongoose.Schema({
  // Human-readable unique case identifier (e.g., "CASE-20260123-A1B2")
  case_id: {
    type: String,
    required: true,
    unique: true,
    index: true,
    default: generateCaseId
  },

  // Case metadata
  title: {
    type: String,
    required: true,
    index: 'text'
  },
  description: {
    type: String,
    required: true
  },

  // Severity and priority
  severity: {
    type: String,
    enum: Object.values(CaseSeverity),
    required: true,
    index: true
  },
  priority: {
    type: String,
    enum: Object.values(CasePriority),
    default: CasePriority.P3
  },

  // Case status (finite state machine)
  status: {
    type: String,
    enum: Object.values(CaseStatus),
    default: CaseStatus.OPEN,
    required: true,
    index: true
  },

  // Assignment tracking
  assigned_to: {
    type: String,
    index: true
  },
  assigned_at: Date,
  assigned_by: String,

  // Creator tracking
  created_by: {
    type: String,
    required: true
  },

  // Linked executions (one or many)
  // Cases are DERIVED from executions, not alerts
  linked_execution_ids: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Execution'
  }],

  // Primary execution (the one that created the case)
  primary_execution_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Execution',
    required: true
  },

  // Tags for categorization and filtering
  tags: [{
    type: String,
    index: true
  }],

  // SLA tracking
  sla_deadlines: slaDeadlineSchema,

  // Audit timeline (immutable)
  timeline: [timelineEventSchema],

  // Evidence collection
  evidence: [evidenceSchema],

  // Resolution information
  resolution_summary: String,
  resolved_at: Date,
  resolved_by: String,

  // Closure information
  closed_at: Date,
  closed_by: String,

  // Metadata for extensions
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

// ============================================================================
// PERFORMANCE INDEXES
// ============================================================================

// Status filtering and chronological sorting
caseSchema.index(
  { status: 1, created_at: -1 },
  { name: 'idx_status_created', background: true }
);

// Severity filtering with time sorting
caseSchema.index(
  { severity: 1, created_at: -1 },
  { name: 'idx_severity_created', background: true }
);

// Assignment filtering
caseSchema.index(
  { assigned_to: 1, status: 1, created_at: -1 },
  { name: 'idx_assigned_status_created', background: true }
);

// Created by filtering
caseSchema.index(
  { created_by: 1, created_at: -1 },
  { name: 'idx_creator_created', background: true }
);

// SLA breach detection
caseSchema.index(
  { 'sla_deadlines.acknowledge.breached': 1 },
  { name: 'idx_sla_acknowledge_breach', background: true }
);

caseSchema.index(
  { 'sla_deadlines.resolve.breached': 1 },
  { name: 'idx_sla_resolve_breach', background: true }
);

// Execution linkage (for finding all cases related to an execution)
caseSchema.index(
  { linked_execution_ids: 1 },
  { name: 'idx_linked_executions', background: true }
);

caseSchema.index(
  { primary_execution_id: 1 },
  { name: 'idx_primary_execution', background: true }
);

// Tags filtering
caseSchema.index(
  { tags: 1, created_at: -1 },
  { name: 'idx_tags_created', background: true }
);

// Time range queries
caseSchema.index(
  { created_at: -1 },
  { name: 'idx_created_at', background: true }
);

// ============================================================================
// INSTANCE METHODS
// ============================================================================

/**
 * Add an event to the immutable timeline
 */
caseSchema.methods.addTimelineEvent = function(eventType, actor, description, metadata = {}) {
  this.timeline.push({
    timestamp: new Date(),
    event_type: eventType,
    actor,
    description,
    metadata
  });
  return this;
};

/**
 * Transition case status with validation
 * Implements finite state machine logic
 */
caseSchema.methods.transitionStatus = function(newStatus, actor, reason = '') {
  const validTransitions = {
    [CaseStatus.OPEN]: [CaseStatus.INVESTIGATING, CaseStatus.CLOSED],
    [CaseStatus.INVESTIGATING]: [CaseStatus.PENDING, CaseStatus.RESOLVED, CaseStatus.CLOSED],
    [CaseStatus.PENDING]: [CaseStatus.INVESTIGATING, CaseStatus.RESOLVED, CaseStatus.CLOSED],
    [CaseStatus.RESOLVED]: [CaseStatus.CLOSED, CaseStatus.INVESTIGATING],
    [CaseStatus.CLOSED]: [CaseStatus.INVESTIGATING] // Allow reopening
  };

  const allowed = validTransitions[this.status] || [];
  if (!allowed.includes(newStatus)) {
    throw new Error(`Invalid status transition from ${this.status} to ${newStatus}`);
  }

  const oldStatus = this.status;
  this.status = newStatus;

  // Add timeline event
  this.addTimelineEvent(
    'status_changed',
    actor,
    `Status changed from ${oldStatus} to ${newStatus}${reason ? `: ${reason}` : ''}`,
    { old_status: oldStatus, new_status: newStatus, reason }
  );

  // Track resolution time
  if (newStatus === CaseStatus.RESOLVED && !this.resolved_at) {
    this.resolved_at = new Date();
    this.resolved_by = actor;
  }

  // Track closure time
  if (newStatus === CaseStatus.CLOSED && !this.closed_at) {
    this.closed_at = new Date();
    this.closed_by = actor;
  }

  return this;
};

/**
 * Assign case to analyst
 */
caseSchema.methods.assignTo = function(analyst, assignedBy) {
  const previousAssignee = this.assigned_to;
  this.assigned_to = analyst;
  this.assigned_at = new Date();
  this.assigned_by = assignedBy;

  this.addTimelineEvent(
    'assigned',
    assignedBy,
    previousAssignee
      ? `Reassigned from ${previousAssignee} to ${analyst}`
      : `Assigned to ${analyst}`,
    { previous_assignee: previousAssignee, new_assignee: analyst }
  );

  return this;
};

/**
 * Link an execution to this case
 */
caseSchema.methods.linkExecution = function(executionId, actor) {
  if (!this.linked_execution_ids.includes(executionId)) {
    this.linked_execution_ids.push(executionId);
    this.addTimelineEvent(
      'execution_linked',
      actor,
      `Linked execution ${executionId}`,
      { execution_id: executionId }
    );
  }
  return this;
};

/**
 * Unlink an execution from this case
 */
caseSchema.methods.unlinkExecution = function(executionId, actor) {
  const index = this.linked_execution_ids.indexOf(executionId);
  if (index > -1) {
    this.linked_execution_ids.splice(index, 1);
    this.addTimelineEvent(
      'execution_unlinked',
      actor,
      `Unlinked execution ${executionId}`,
      { execution_id: executionId }
    );
  }
  return this;
};

/**
 * Add evidence to case
 */
caseSchema.methods.addEvidence = function(evidence, actor) {
  this.evidence.push({
    ...evidence,
    added_by: actor,
    added_at: new Date()
  });

  this.addTimelineEvent(
    'evidence_added',
    actor,
    `Added evidence: ${evidence.name}`,
    { evidence_type: evidence.type, evidence_name: evidence.name }
  );

  return this;
};

/**
 * Check and update SLA breach status
 */
caseSchema.methods.checkSLABreaches = function() {
  const now = new Date();
  let breached = false;

  // Check acknowledge SLA
  if (this.sla_deadlines?.acknowledge?.deadline) {
    if (now > this.sla_deadlines.acknowledge.deadline && !this.sla_deadlines.acknowledge.breached) {
      this.sla_deadlines.acknowledge.breached = true;
      this.sla_deadlines.acknowledge.breach_time = now;
      this.addTimelineEvent(
        'sla_breached',
        'system',
        'SLA breach: Acknowledgement deadline exceeded',
        { sla_type: 'acknowledge', deadline: this.sla_deadlines.acknowledge.deadline }
      );
      breached = true;
    }
  }

  // Check resolve SLA
  if (this.sla_deadlines?.resolve?.deadline) {
    if (now > this.sla_deadlines.resolve.deadline && !this.sla_deadlines.resolve.breached) {
      this.sla_deadlines.resolve.breached = true;
      this.sla_deadlines.resolve.breach_time = now;
      this.addTimelineEvent(
        'sla_breached',
        'system',
        'SLA breach: Resolution deadline exceeded',
        { sla_type: 'resolve', deadline: this.sla_deadlines.resolve.deadline }
      );
      breached = true;
    }
  }

  return breached;
};

const Case = mongoose.model('Case', caseSchema);

export default Case;
