/**
 * Case Management API Routes
 * REST endpoints for SOC-grade case management
 *
 * ARCHITECTURE:
 * - Cases are derived from Executions (not alerts)
 * - All state transitions validated via FSM
 * - Full audit trail via timeline
 * - SLA tracking integrated
 */

import express from 'express';
import {
  createCaseFromExecution,
  getCases,
  getCase,
  updateCase,
  transitionCaseStatus,
  assignCase,
  linkExecutionToCase,
  unlinkExecutionFromCase,
  addEvidenceToCase,
  addCaseComment,
  getCaseComments,
  getCaseTimeline,
  getCaseStats,
  getAssignedCases
} from '../services/case-service.js';
import logger from '../utils/logger.js';

const router = express.Router();

// ============================================================================
// CASE CRUD OPERATIONS
// ============================================================================

/**
 * GET /api/cases/stats
 * Get case statistics for dashboard
 *
 * Query params:
 *   - from_date: ISO 8601 date
 *   - to_date: ISO 8601 date
 */
router.get('/cases/stats', async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    const filters = {};
    if (from_date) filters.from_date = from_date;
    if (to_date) filters.to_date = to_date;

    const stats = await getCaseStats(filters);
    res.json(stats);
  } catch (error) {
    logger.error('Error fetching case stats:', error);
    res.status(500).json({ error: 'Failed to fetch case stats', message: error.message });
  }
});

/**
 * GET /api/cases/assigned/:analyst
 * Get all cases assigned to a specific analyst
 *
 * Query params:
 *   - status: Filter by status
 */
router.get('/cases/assigned/:analyst', async (req, res) => {
  try {
    const { status } = req.query;
    const cases = await getAssignedCases(req.params.analyst, status);
    res.json(cases);
  } catch (error) {
    logger.error('Error fetching assigned cases:', error);
    res.status(500).json({ error: 'Failed to fetch assigned cases', message: error.message });
  }
});

/**
 * GET /api/cases
 * List all cases with filtering and pagination
 *
 * Query params:
 *   - status: OPEN | INVESTIGATING | PENDING | RESOLVED | CLOSED (can be array)
 *   - severity: CRITICAL | HIGH | MEDIUM | LOW (can be array)
 *   - assigned_to: Filter by assignee email
 *   - created_by: Filter by creator email
 *   - tags: Filter by tags (can be array)
 *   - sla_breached: true | false
 *   - from_date: ISO 8601 date (created_at >=)
 *   - to_date: ISO 8601 date (created_at <=)
 *   - limit: Pagination limit (default 100, max 500)
 *   - offset: Pagination offset
 *   - sort_by: case_id | created_at | severity | status
 *   - sort_order: asc | desc
 */
router.get('/cases', async (req, res) => {
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
      limit,
      offset,
      sort_by,
      sort_order
    } = req.query;

    const filters = {};
    if (status) filters.status = status.includes(',') ? status.split(',') : status;
    if (severity) filters.severity = severity.includes(',') ? severity.split(',') : severity;
    if (assigned_to) filters.assigned_to = assigned_to;
    if (created_by) filters.created_by = created_by;
    if (tags) filters.tags = tags.includes(',') ? tags.split(',') : tags;
    if (sla_breached !== undefined) filters.sla_breached = sla_breached;
    if (from_date) filters.from_date = from_date;
    if (to_date) filters.to_date = to_date;
    if (limit) filters.limit = parseInt(limit);
    if (offset) filters.offset = parseInt(offset);
    if (sort_by) filters.sort_by = sort_by;
    if (sort_order) filters.sort_order = sort_order;

    const result = await getCases(filters);
    res.json(result);
  } catch (error) {
    logger.error('Error fetching cases:', error);
    res.status(500).json({ error: 'Failed to fetch cases', message: error.message });
  }
});

/**
 * GET /api/cases/:id
 * Get case details with linked executions
 *
 * Params:
 *   - id: case_id or MongoDB _id
 */
router.get('/cases/:id', async (req, res) => {
  try {
    const caseDoc = await getCase(req.params.id);
    if (!caseDoc) {
      return res.status(404).json({ error: 'Case not found' });
    }
    res.json(caseDoc);
  } catch (error) {
    logger.error('Error fetching case:', error);
    res.status(500).json({ error: 'Failed to fetch case', message: error.message });
  }
});

/**
 * POST /api/cases/from-execution/:execution_id
 * Create a new case from an execution
 *
 * Body:
 *   - title: string (optional - auto-generated if not provided)
 *   - description: string (optional - auto-generated if not provided)
 *   - severity: CRITICAL | HIGH | MEDIUM | LOW (optional - derived from execution)
 *   - priority: P1 | P2 | P3 | P4 (optional)
 *   - assigned_to: string (optional)
 *   - tags: string[] (optional)
 */
router.post('/cases/from-execution/:execution_id', async (req, res) => {
  try {
    const userId = req.user?.email || req.body.created_by || 'analyst';
    const caseDoc = await createCaseFromExecution(
      req.params.execution_id,
      req.body,
      userId
    );
    res.status(201).json(caseDoc);
  } catch (error) {
    logger.error('Error creating case from execution:', error);
    res.status(500).json({ error: 'Failed to create case', message: error.message });
  }
});

/**
 * PUT /api/cases/:id
 * Update case fields
 *
 * Body:
 *   - title: string
 *   - description: string
 *   - severity: CRITICAL | HIGH | MEDIUM | LOW
 *   - priority: P1 | P2 | P3 | P4
 *   - tags: string[]
 *   - resolution_summary: string
 */
router.put('/cases/:id', async (req, res) => {
  try {
    const userId = req.user?.email || 'analyst';
    const caseDoc = await updateCase(req.params.id, req.body, userId);
    res.json(caseDoc);
  } catch (error) {
    logger.error('Error updating case:', error);
    res.status(500).json({ error: 'Failed to update case', message: error.message });
  }
});

/**
 * PATCH /api/cases/:id/status
 * Transition case status with FSM validation
 *
 * Body:
 *   - status: OPEN | INVESTIGATING | PENDING | RESOLVED | CLOSED
 *   - reason: string (optional)
 */
router.patch('/cases/:id/status', async (req, res) => {
  try {
    const { status, reason } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const userId = req.user?.email || 'analyst';
    const caseDoc = await transitionCaseStatus(req.params.id, status, userId, reason);
    res.json(caseDoc);
  } catch (error) {
    logger.error('Error transitioning case status:', error);
    res.status(500).json({ error: 'Failed to transition status', message: error.message });
  }
});

/**
 * PATCH /api/cases/:id/assign
 * Assign case to analyst
 *
 * Body:
 *   - assigned_to: string (analyst email)
 */
router.patch('/cases/:id/assign', async (req, res) => {
  try {
    const { assigned_to } = req.body;
    if (!assigned_to) {
      return res.status(400).json({ error: 'assigned_to is required' });
    }

    const userId = req.user?.email || 'analyst';
    const caseDoc = await assignCase(req.params.id, assigned_to, userId);
    res.json(caseDoc);
  } catch (error) {
    logger.error('Error assigning case:', error);
    res.status(500).json({ error: 'Failed to assign case', message: error.message });
  }
});

// ============================================================================
// EXECUTION LINKING
// ============================================================================

/**
 * POST /api/cases/:id/link-execution/:execution_id
 * Link an execution to an existing case
 */
router.post('/cases/:id/link-execution/:execution_id', async (req, res) => {
  try {
    const userId = req.user?.email || 'analyst';
    const caseDoc = await linkExecutionToCase(
      req.params.id,
      req.params.execution_id,
      userId
    );
    res.json(caseDoc);
  } catch (error) {
    logger.error('Error linking execution to case:', error);
    res.status(500).json({ error: 'Failed to link execution', message: error.message });
  }
});

/**
 * DELETE /api/cases/:id/unlink-execution/:execution_id
 * Unlink an execution from a case
 */
router.delete('/cases/:id/unlink-execution/:execution_id', async (req, res) => {
  try {
    const userId = req.user?.email || 'analyst';
    const caseDoc = await unlinkExecutionFromCase(
      req.params.id,
      req.params.execution_id,
      userId
    );
    res.json(caseDoc);
  } catch (error) {
    logger.error('Error unlinking execution from case:', error);
    res.status(500).json({ error: 'Failed to unlink execution', message: error.message });
  }
});

// ============================================================================
// EVIDENCE MANAGEMENT
// ============================================================================

/**
 * POST /api/cases/:id/evidence
 * Add evidence to case
 *
 * Body:
 *   - type: file | url | hash | note | screenshot | log | other
 *   - name: string
 *   - description: string (optional)
 *   - content: any (file data, URL, hash value, etc.)
 *   - metadata: object (optional)
 */
router.post('/cases/:id/evidence', async (req, res) => {
  try {
    const { type, name, description, content, metadata } = req.body;
    if (!type || !name) {
      return res.status(400).json({ error: 'type and name are required' });
    }

    const userId = req.user?.email || 'analyst';
    const evidence = { type, name, description, content, metadata };
    const caseDoc = await addEvidenceToCase(req.params.id, evidence, userId);
    res.json(caseDoc);
  } catch (error) {
    logger.error('Error adding evidence to case:', error);
    res.status(500).json({ error: 'Failed to add evidence', message: error.message });
  }
});

// ============================================================================
// COMMENTS & TIMELINE
// ============================================================================

/**
 * POST /api/cases/:id/comments
 * Add a comment to case
 *
 * Body:
 *   - content: string
 *   - comment_type: note | update | analysis | resolution | internal | external
 *   - visibility: internal | external | restricted
 *   - metadata: object (optional)
 */
router.post('/cases/:id/comments', async (req, res) => {
  try {
    const { content, comment_type, visibility, metadata } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    const userId = req.user?.email || 'analyst';
    const comment = await addCaseComment(
      req.params.id,
      { content, comment_type, visibility, metadata },
      userId
    );
    res.status(201).json(comment);
  } catch (error) {
    logger.error('Error adding case comment:', error);
    res.status(500).json({ error: 'Failed to add comment', message: error.message });
  }
});

/**
 * GET /api/cases/:id/comments
 * Get all comments for a case
 */
router.get('/cases/:id/comments', async (req, res) => {
  try {
    const comments = await getCaseComments(req.params.id);
    res.json(comments);
  } catch (error) {
    logger.error('Error fetching case comments:', error);
    res.status(500).json({ error: 'Failed to fetch comments', message: error.message });
  }
});

/**
 * GET /api/cases/:id/timeline
 * Get complete case timeline (audit trail + comments)
 */
router.get('/cases/:id/timeline', async (req, res) => {
  try {
    const timeline = await getCaseTimeline(req.params.id);
    res.json(timeline);
  } catch (error) {
    logger.error('Error fetching case timeline:', error);
    res.status(500).json({ error: 'Failed to fetch timeline', message: error.message });
  }
});

export default router;
