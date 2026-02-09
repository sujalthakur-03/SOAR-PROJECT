/**
 * Case Service
 * Business logic for SOC-grade case management
 *
 * ARCHITECTURE RULES:
 * - Cases are DERIVED from Executions (not alerts)
 * - All state transitions are validated via FSM
 * - Timeline is immutable and audit-safe
 * - SLA tracking is integrated with execution SLAs
 */

import mongoose from 'mongoose';
import Case, { CaseStatus, CaseSeverity, CasePriority } from '../models/case.js';
import CaseComment from '../models/case-comment.js';
import Execution from '../models/execution.js';
import logger from '../utils/logger.js';

/**
 * Build a safe $or query that only includes _id when the value is a valid ObjectId.
 * Prevents Mongoose CastError when looking up by human-readable IDs.
 */
function buildIdQuery(humanField, value) {
  if (mongoose.Types.ObjectId.isValid(value) && String(new mongoose.Types.ObjectId(value)) === value) {
    return { $or: [{ [humanField]: value }, { _id: value }] };
  }
  return { [humanField]: value };
}

function buildExecutionQuery(value) {
  return buildIdQuery('execution_id', value);
}

function buildCaseQuery(value) {
  return buildIdQuery('case_id', value);
}

// ============================================================================
// SLA CONFIGURATION (in milliseconds)
// ============================================================================
const SLA_THRESHOLDS = {
  [CaseSeverity.CRITICAL]: {
    acknowledge: 15 * 60 * 1000, // 15 minutes
    investigate: 1 * 60 * 60 * 1000, // 1 hour
    resolve: 4 * 60 * 60 * 1000, // 4 hours
    close: 24 * 60 * 60 * 1000 // 24 hours
  },
  [CaseSeverity.HIGH]: {
    acknowledge: 30 * 60 * 1000, // 30 minutes
    investigate: 2 * 60 * 60 * 1000, // 2 hours
    resolve: 8 * 60 * 60 * 1000, // 8 hours
    close: 48 * 60 * 60 * 1000 // 48 hours
  },
  [CaseSeverity.MEDIUM]: {
    acknowledge: 1 * 60 * 60 * 1000, // 1 hour
    investigate: 4 * 60 * 60 * 1000, // 4 hours
    resolve: 24 * 60 * 60 * 1000, // 24 hours
    close: 7 * 24 * 60 * 60 * 1000 // 7 days
  },
  [CaseSeverity.LOW]: {
    acknowledge: 4 * 60 * 60 * 1000, // 4 hours
    investigate: 8 * 60 * 60 * 1000, // 8 hours
    resolve: 7 * 24 * 60 * 60 * 1000, // 7 days
    close: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
};

/**
 * Calculate SLA deadlines based on severity
 */
function calculateSLADeadlines(severity, createdAt = new Date()) {
  const thresholds = SLA_THRESHOLDS[severity] || SLA_THRESHOLDS[CaseSeverity.MEDIUM];
  const created = new Date(createdAt);

  return {
    acknowledge: {
      deadline: new Date(created.getTime() + thresholds.acknowledge),
      breached: false
    },
    investigate: {
      deadline: new Date(created.getTime() + thresholds.investigate),
      breached: false
    },
    resolve: {
      deadline: new Date(created.getTime() + thresholds.resolve),
      breached: false
    },
    close: {
      deadline: new Date(created.getTime() + thresholds.close),
      breached: false
    }
  };
}

// ============================================================================
// CASE CRUD OPERATIONS
// ============================================================================

/**
 * Create a new case from an execution
 * This is the PRIMARY way cases are created
 */
export async function createCaseFromExecution(executionId, caseData, createdBy) {
  try {
    // Fetch the execution to derive case data
    const execution = await Execution.findOne(buildExecutionQuery(executionId));

    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    // Derive severity from execution trigger_data if not provided
    let severity = caseData.severity;
    if (!severity && execution.trigger_data?.severity) {
      severity = execution.trigger_data.severity.toUpperCase();
      if (!Object.values(CaseSeverity).includes(severity)) {
        severity = CaseSeverity.MEDIUM;
      }
    }
    severity = severity || CaseSeverity.MEDIUM;

    // Auto-generate title if not provided
    const title = caseData.title || `Incident: ${execution.playbook_name} - ${execution.execution_id}`;

    // Auto-generate description if not provided
    const description = caseData.description ||
      `Case created from execution ${execution.execution_id} (${execution.playbook_name})`;

    // Calculate SLA deadlines
    const slaDeadlines = calculateSLADeadlines(severity);

    // Create case
    const caseDoc = new Case({
      title,
      description,
      severity,
      priority: caseData.priority || (severity === CaseSeverity.CRITICAL ? CasePriority.P1 :
                severity === CaseSeverity.HIGH ? CasePriority.P2 : CasePriority.P3),
      status: CaseStatus.OPEN,
      created_by: createdBy,
      primary_execution_id: execution._id,
      linked_execution_ids: [execution._id],
      tags: caseData.tags || [],
      sla_deadlines: slaDeadlines,
      assigned_to: caseData.assigned_to,
      metadata: {
        source_execution: execution.execution_id,
        source_playbook: execution.playbook_id,
        trigger_data_snapshot: execution.trigger_data
      }
    });

    // Add creation timeline event
    caseDoc.addTimelineEvent(
      'case_created',
      createdBy,
      `Case created from execution ${execution.execution_id}`,
      {
        execution_id: execution.execution_id,
        playbook_id: execution.playbook_id,
        severity
      }
    );

    // If assigned, add assignment event
    if (caseData.assigned_to) {
      caseDoc.assignTo(caseData.assigned_to, createdBy);
    }

    await caseDoc.save();

    logger.info(`Case ${caseDoc.case_id} created from execution ${execution.execution_id} by ${createdBy}`);

    return caseDoc;
  } catch (error) {
    logger.error('Error creating case from execution:', error);
    throw error;
  }
}

/**
 * Get all cases with filtering and pagination
 */
export async function getCases(filters = {}) {
  try {
    const {
      status,
      severity,
      assigned_to,
      created_by,
      tags,
      sla_breached,
      from_date,
      to_date,
      limit = 100,
      offset = 0,
      sort_by = 'created_at',
      sort_order = 'desc'
    } = filters;

    const query = {};

    // Status filter
    if (status) {
      if (Array.isArray(status)) {
        query.status = { $in: status };
      } else {
        query.status = status;
      }
    }

    // Severity filter
    if (severity) {
      if (Array.isArray(severity)) {
        query.severity = { $in: severity };
      } else {
        query.severity = severity;
      }
    }

    // Assignment filter
    if (assigned_to) {
      query.assigned_to = assigned_to;
    }

    // Creator filter
    if (created_by) {
      query.created_by = created_by;
    }

    // Tags filter (match any)
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : [tags];
      query.tags = { $in: tagArray };
    }

    // SLA breach filter
    if (sla_breached === 'true' || sla_breached === true) {
      query.$or = [
        { 'sla_deadlines.acknowledge.breached': true },
        { 'sla_deadlines.resolve.breached': true }
      ];
    }

    // Date range filter
    if (from_date || to_date) {
      query.created_at = {};
      if (from_date) {
        query.created_at.$gte = new Date(from_date);
      }
      if (to_date) {
        query.created_at.$lte = new Date(to_date);
      }
    }

    // Build sort
    const sort = {};
    sort[sort_by] = sort_order === 'asc' ? 1 : -1;

    // Execute query
    const [cases, total] = await Promise.all([
      Case.find(query)
        .sort(sort)
        .limit(parseInt(limit))
        .skip(parseInt(offset))
        .lean(),
      Case.countDocuments(query)
    ]);

    return {
      data: cases,
      total,
      page: Math.floor(offset / limit) + 1,
      page_size: cases.length,
      total_pages: Math.ceil(total / limit)
    };
  } catch (error) {
    logger.error('Error fetching cases:', error);
    throw error;
  }
}

/**
 * Get a single case by case_id or MongoDB _id
 */
export async function getCase(caseId) {
  try {
    const caseDoc = await Case.findOne(buildCaseQuery(caseId))
    .populate('linked_execution_ids', 'execution_id playbook_name state trigger_data created_at')
    .populate('primary_execution_id', 'execution_id playbook_name state trigger_data created_at')
    .lean();

    if (!caseDoc) {
      return null;
    }

    // Check for SLA breaches
    const caseMutable = await Case.findById(caseDoc._id);
    const breached = caseMutable.checkSLABreaches();
    if (breached) {
      await caseMutable.save();
      // Refresh case data
      return getCase(caseId);
    }

    return caseDoc;
  } catch (error) {
    logger.error('Error fetching case:', error);
    throw error;
  }
}

/**
 * Update case fields
 */
export async function updateCase(caseId, updates, updatedBy) {
  try {
    const caseDoc = await Case.findOne(buildCaseQuery(caseId));

    if (!caseDoc) {
      throw new Error(`Case ${caseId} not found`);
    }

    // Update allowed fields
    const allowedFields = ['title', 'description', 'severity', 'priority', 'tags', 'resolution_summary'];
    let changed = false;

    for (const field of allowedFields) {
      if (updates[field] !== undefined && updates[field] !== caseDoc[field]) {
        caseDoc[field] = updates[field];
        changed = true;
      }
    }

    if (changed) {
      caseDoc.addTimelineEvent(
        'case_updated',
        updatedBy,
        'Case details updated',
        { updated_fields: Object.keys(updates).filter(k => allowedFields.includes(k)) }
      );
      await caseDoc.save();
    }

    return caseDoc;
  } catch (error) {
    logger.error('Error updating case:', error);
    throw error;
  }
}

/**
 * Transition case status with FSM validation
 */
export async function transitionCaseStatus(caseId, newStatus, actor, reason = '') {
  try {
    const caseDoc = await Case.findOne(buildCaseQuery(caseId));

    if (!caseDoc) {
      throw new Error(`Case ${caseId} not found`);
    }

    caseDoc.transitionStatus(newStatus, actor, reason);
    await caseDoc.save();

    logger.info(`Case ${caseDoc.case_id} status changed to ${newStatus} by ${actor}`);

    return caseDoc;
  } catch (error) {
    logger.error('Error transitioning case status:', error);
    throw error;
  }
}

/**
 * Assign case to analyst
 */
export async function assignCase(caseId, analyst, assignedBy) {
  try {
    const caseDoc = await Case.findOne(buildCaseQuery(caseId));

    if (!caseDoc) {
      throw new Error(`Case ${caseId} not found`);
    }

    caseDoc.assignTo(analyst, assignedBy);
    await caseDoc.save();

    logger.info(`Case ${caseDoc.case_id} assigned to ${analyst} by ${assignedBy}`);

    return caseDoc;
  } catch (error) {
    logger.error('Error assigning case:', error);
    throw error;
  }
}

/**
 * Link an execution to an existing case
 */
export async function linkExecutionToCase(caseId, executionId, actor) {
  try {
    const caseDoc = await Case.findOne(buildCaseQuery(caseId));

    if (!caseDoc) {
      throw new Error(`Case ${caseId} not found`);
    }

    const execution = await Execution.findOne(buildExecutionQuery(executionId));

    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    caseDoc.linkExecution(execution._id, actor);
    await caseDoc.save();

    logger.info(`Execution ${execution.execution_id} linked to case ${caseDoc.case_id} by ${actor}`);

    return caseDoc;
  } catch (error) {
    logger.error('Error linking execution to case:', error);
    throw error;
  }
}

/**
 * Unlink an execution from a case
 */
export async function unlinkExecutionFromCase(caseId, executionId, actor) {
  try {
    const caseDoc = await Case.findOne(buildCaseQuery(caseId));

    if (!caseDoc) {
      throw new Error(`Case ${caseId} not found`);
    }

    const execution = await Execution.findOne(buildExecutionQuery(executionId));

    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    // Cannot unlink primary execution
    if (caseDoc.primary_execution_id.equals(execution._id)) {
      throw new Error('Cannot unlink primary execution from case');
    }

    caseDoc.unlinkExecution(execution._id, actor);
    await caseDoc.save();

    logger.info(`Execution ${execution.execution_id} unlinked from case ${caseDoc.case_id} by ${actor}`);

    return caseDoc;
  } catch (error) {
    logger.error('Error unlinking execution from case:', error);
    throw error;
  }
}

/**
 * Add evidence to case
 */
export async function addEvidenceToCase(caseId, evidence, actor) {
  try {
    const caseDoc = await Case.findOne(buildCaseQuery(caseId));

    if (!caseDoc) {
      throw new Error(`Case ${caseId} not found`);
    }

    caseDoc.addEvidence(evidence, actor);
    await caseDoc.save();

    logger.info(`Evidence added to case ${caseDoc.case_id} by ${actor}`);

    return caseDoc;
  } catch (error) {
    logger.error('Error adding evidence to case:', error);
    throw error;
  }
}

// ============================================================================
// CASE COMMENTS
// ============================================================================

/**
 * Add a comment to a case
 */
export async function addCaseComment(caseId, commentData, author) {
  try {
    // Verify case exists
    const caseDoc = await Case.findOne(buildCaseQuery(caseId));

    if (!caseDoc) {
      throw new Error(`Case ${caseId} not found`);
    }

    // Create comment
    const comment = new CaseComment({
      case_id: caseDoc.case_id,
      content: commentData.content,
      comment_type: commentData.comment_type || 'note',
      author,
      visibility: commentData.visibility || 'internal',
      metadata: commentData.metadata || {}
    });

    await comment.save();

    // Add timeline event to case
    caseDoc.addTimelineEvent(
      'comment_added',
      author,
      `Comment added: ${commentData.content.substring(0, 50)}${commentData.content.length > 50 ? '...' : ''}`,
      { comment_id: comment._id, comment_type: commentData.comment_type }
    );
    await caseDoc.save();

    logger.info(`Comment added to case ${caseDoc.case_id} by ${author}`);

    return comment;
  } catch (error) {
    logger.error('Error adding case comment:', error);
    throw error;
  }
}

/**
 * Get all comments for a case
 */
export async function getCaseComments(caseId, includeDeleted = false) {
  try {
    const query = { case_id: caseId };
    if (!includeDeleted) {
      query.deleted = false;
    }

    const comments = await CaseComment.find(query)
      .sort({ created_at: 1 })
      .lean();

    return comments;
  } catch (error) {
    logger.error('Error fetching case comments:', error);
    throw error;
  }
}

/**
 * Get case timeline (audit trail from case + comments)
 */
export async function getCaseTimeline(caseId) {
  try {
    const caseDoc = await Case.findOne(buildCaseQuery(caseId)).lean();

    if (!caseDoc) {
      throw new Error(`Case ${caseId} not found`);
    }

    // Get all comments
    const comments = await getCaseComments(caseDoc.case_id, false);

    // Merge timeline events and comments
    const timeline = [
      ...caseDoc.timeline.map(event => ({
        ...event,
        source: 'case_event'
      })),
      ...comments.map(comment => ({
        timestamp: comment.created_at,
        event_type: 'comment',
        actor: comment.author,
        description: comment.content,
        metadata: {
          comment_type: comment.comment_type,
          comment_id: comment._id
        },
        source: 'comment'
      }))
    ];

    // Sort by timestamp
    timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return timeline;
  } catch (error) {
    logger.error('Error fetching case timeline:', error);
    throw error;
  }
}

// ============================================================================
// CASE STATISTICS
// ============================================================================

/**
 * Get case statistics for dashboard
 */
export async function getCaseStats(filters = {}) {
  try {
    const { from_date, to_date } = filters;
    const dateQuery = {};

    if (from_date || to_date) {
      dateQuery.created_at = {};
      if (from_date) {
        dateQuery.created_at.$gte = new Date(from_date);
      }
      if (to_date) {
        dateQuery.created_at.$lte = new Date(to_date);
      }
    }

    const [
      total,
      byStatus,
      bySeverity,
      slaBreached,
      avgResolutionTime
    ] = await Promise.all([
      // Total cases
      Case.countDocuments(dateQuery),

      // By status
      Case.aggregate([
        { $match: dateQuery },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),

      // By severity
      Case.aggregate([
        { $match: dateQuery },
        { $group: { _id: '$severity', count: { $sum: 1 } } }
      ]),

      // SLA breached
      Case.countDocuments({
        ...dateQuery,
        $or: [
          { 'sla_deadlines.acknowledge.breached': true },
          { 'sla_deadlines.resolve.breached': true }
        ]
      }),

      // Average resolution time
      Case.aggregate([
        {
          $match: {
            ...dateQuery,
            status: CaseStatus.RESOLVED,
            resolved_at: { $exists: true }
          }
        },
        {
          $project: {
            resolution_time: {
              $subtract: ['$resolved_at', '$created_at']
            }
          }
        },
        {
          $group: {
            _id: null,
            avg_resolution_ms: { $avg: '$resolution_time' }
          }
        }
      ])
    ]);

    // Format results
    const statusBreakdown = {};
    byStatus.forEach(item => {
      statusBreakdown[item._id] = item.count;
    });

    const severityBreakdown = {};
    bySeverity.forEach(item => {
      severityBreakdown[item._id] = item.count;
    });

    return {
      total_cases: total,
      open: statusBreakdown[CaseStatus.OPEN] || 0,
      investigating: statusBreakdown[CaseStatus.INVESTIGATING] || 0,
      pending: statusBreakdown[CaseStatus.PENDING] || 0,
      resolved: statusBreakdown[CaseStatus.RESOLVED] || 0,
      closed: statusBreakdown[CaseStatus.CLOSED] || 0,
      severity: {
        critical: severityBreakdown[CaseSeverity.CRITICAL] || 0,
        high: severityBreakdown[CaseSeverity.HIGH] || 0,
        medium: severityBreakdown[CaseSeverity.MEDIUM] || 0,
        low: severityBreakdown[CaseSeverity.LOW] || 0
      },
      sla_breached: slaBreached,
      avg_resolution_time_ms: avgResolutionTime[0]?.avg_resolution_ms || 0,
      avg_resolution_time_hours: avgResolutionTime[0]?.avg_resolution_ms
        ? (avgResolutionTime[0].avg_resolution_ms / (1000 * 60 * 60)).toFixed(2)
        : 0
    };
  } catch (error) {
    logger.error('Error fetching case stats:', error);
    throw error;
  }
}

/**
 * Get cases assigned to a specific analyst
 */
export async function getAssignedCases(analyst, status = null) {
  try {
    const query = { assigned_to: analyst };
    if (status) {
      query.status = status;
    }

    const cases = await Case.find(query)
      .sort({ created_at: -1 })
      .lean();

    return cases;
  } catch (error) {
    logger.error('Error fetching assigned cases:', error);
    throw error;
  }
}
