/**
 * CyberSentinel SOAR - REST API Routes
 * Provides endpoints for frontend to fetch/update data from MongoDB
 *
 * CRITICAL: NO alert ingestion endpoints - use webhooks instead
 *
 * EXECUTION STATE VALUES (CANONICAL):
 *   - EXECUTING: Currently running
 *   - WAITING_APPROVAL: Paused waiting for approval
 *   - COMPLETED: Successfully finished
 *   - FAILED: Execution failed
 */

import express from 'express';
import {
  getPlaybooks,
  getPlaybook,
  createPlaybook,
  updatePlaybook,
  deletePlaybook,
  togglePlaybook,
  getWebhookInfo,
  rotateWebhookSecret,
  toggleWebhook
} from '../services/playbook-service.js';
import {
  getExecutions,
  getExecution,
  createExecution,
  updateExecutionState,
  cancelExecution,
  getExecutionStats,
  getExecutionStatsDetailed
} from '../services/execution-service.js';
import {
  getApprovals,
  getApproval,
  approveAction,
  rejectAction
} from '../services/approval-service.js';
import {
  getConnectors,
  getConnector,
  createConnector,
  updateConnector,
  toggleConnector,
  deleteConnector,
  testConnector
} from '../services/connector-service.js';
import {
  getAuditLogs,
  getResourceAuditLogs,
  getAuditStats
} from '../services/audit-service.js';
import logger from '../utils/logger.js';

// Import versioned playbook routes (Agent 9)
import playbookRoutesV2 from './playbook-routes.js';

const router = express.Router();

// ============================================================================
// VERSIONED PLAYBOOK ROUTES (Agent 9)
// ============================================================================
// Mount versioned playbook management routes
// These routes provide full versioning support with immutable playbook_id
router.use('/v2', playbookRoutesV2);

// ============================================================================
// PLAYBOOKS
// ============================================================================

/**
 * GET /api/playbooks
 * Retrieve all playbooks with optional filters
 */
router.get('/playbooks', async (req, res) => {
  try {
    const { status, tags, severity } = req.query;
    const filters = {};
    if (status) filters.status = status;
    if (tags) filters.tags = Array.isArray(tags) ? tags : [tags];
    if (severity) filters.severity = severity;

    const playbooks = await getPlaybooks(filters);
    res.json(playbooks);
  } catch (error) {
    logger.error('Error fetching playbooks:', error);
    res.status(500).json({ error: 'Failed to fetch playbooks', message: error.message });
  }
});

/**
 * GET /api/playbooks/:id
 * Retrieve a specific playbook (by playbook_id or MongoDB _id)
 */
router.get('/playbooks/:id', async (req, res) => {
  try {
    const playbook = await getPlaybook(req.params.id);
    if (!playbook) {
      return res.status(404).json({ error: 'Playbook not found' });
    }
    res.json(playbook);
  } catch (error) {
    logger.error('Error fetching playbook:', error);
    res.status(500).json({ error: 'Failed to fetch playbook', message: error.message });
  }
});

/**
 * POST /api/playbooks
 * Create a new playbook
 */
router.post('/playbooks', async (req, res) => {
  try {
    const userId = req.user?.email || 'system';
    const playbook = await createPlaybook(req.body, userId);
    res.status(201).json(playbook);
  } catch (error) {
    logger.error('Error creating playbook:', error);
    res.status(500).json({ error: 'Failed to create playbook', message: error.message });
  }
});

/**
 * PUT /api/playbooks/:id
 * Update a playbook
 */
router.put('/playbooks/:id', async (req, res) => {
  try {
    const userId = req.user?.email || 'system';
    const playbook = await updatePlaybook(req.params.id, req.body, userId);
    res.json(playbook);
  } catch (error) {
    logger.error('Error updating playbook:', error);
    res.status(500).json({ error: 'Failed to update playbook', message: error.message });
  }
});

/**
 * PATCH /api/playbooks/:id/toggle
 * Toggle playbook enabled/disabled
 */
router.patch('/playbooks/:id/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;
    const playbook = await togglePlaybook(req.params.id, enabled);
    res.json(playbook);
  } catch (error) {
    logger.error('Error toggling playbook:', error);
    res.status(500).json({ error: 'Failed to toggle playbook', message: error.message });
  }
});

/**
 * DELETE /api/playbooks/:id
 * Delete a playbook
 */
router.delete('/playbooks/:id', async (req, res) => {
  try {
    await deletePlaybook(req.params.id);
    res.json({ success: true, id: req.params.id });
  } catch (error) {
    logger.error('Error deleting playbook:', error);
    res.status(500).json({ error: 'Failed to delete playbook', message: error.message });
  }
});

// ============================================================================
// WEBHOOK MANAGEMENT
// ============================================================================

/**
 * GET /api/playbooks/:id/webhook
 * Get webhook configuration for a playbook
 */
router.get('/playbooks/:id/webhook', async (req, res) => {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const webhookInfo = await getWebhookInfo(req.params.id, baseUrl);
    res.json(webhookInfo);
  } catch (error) {
    logger.error('Error getting webhook info:', error);
    res.status(500).json({ error: 'Failed to get webhook info', message: error.message });
  }
});

/**
 * POST /api/playbooks/:id/webhook/rotate
 * Rotate webhook secret for a playbook
 */
router.post('/playbooks/:id/webhook/rotate', async (req, res) => {
  try {
    const result = await rotateWebhookSecret(req.params.id);
    res.json(result);
  } catch (error) {
    logger.error('Error rotating webhook secret:', error);
    res.status(500).json({ error: 'Failed to rotate webhook secret', message: error.message });
  }
});

/**
 * PATCH /api/playbooks/:id/webhook/toggle
 * Enable or disable webhook for a playbook
 */
router.patch('/playbooks/:id/webhook/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;
    const result = await toggleWebhook(req.params.id, enabled);
    res.json(result);
  } catch (error) {
    logger.error('Error toggling webhook:', error);
    res.status(500).json({ error: 'Failed to toggle webhook', message: error.message });
  }
});

// ============================================================================
// EXECUTIONS
// ============================================================================

/**
 * GET /api/executions
 * Retrieve all executions with filtering
 *
 * Query params:
 *   - state: EXECUTING | WAITING_APPROVAL | COMPLETED | FAILED
 *   - playbook_id: Filter by playbook
 *   - severity: Filter by trigger_data.severity (exact match or comma-separated)
 *   - rule_id: Filter by trigger_data.rule_id
 *   - trigger_id: Filter by trigger_snapshot.trigger_id
 *   - webhook_id: Filter by webhook source
 *   - from_time: Filter by event_time >= (ISO 8601)
 *   - to_time: Filter by event_time <= (ISO 8601)
 *   - start_date / end_date: Date range on created_at (DEPRECATED)
 *   - limit: Pagination limit (default 100, max 500)
 *   - offset: Pagination offset
 *   - sort_by: execution_id | event_time | created_at | started_at
 *   - sort_order: asc | desc
 */
router.get('/executions', async (req, res) => {
  try {
    const {
      playbook_id,
      state,
      severity,
      rule_id,
      trigger_id,
      webhook_id,
      from_time,
      to_time,
      start_date,
      end_date,
      limit,
      offset,
      sort_by,
      sort_order
    } = req.query;

    const filters = {};
    if (playbook_id) filters.playbook_id = playbook_id;
    if (state) filters.state = state;

    // Handle severity as array or single value
    if (severity) {
      filters.severity = severity.includes(',') ? severity.split(',') : severity;
    }

    if (rule_id) filters.rule_id = rule_id;
    if (trigger_id) filters.trigger_id = trigger_id;
    if (webhook_id) filters.webhook_id = webhook_id;
    if (from_time) filters.from_time = from_time;
    if (to_time) filters.to_time = to_time;
    if (start_date) filters.start_date = start_date;
    if (end_date) filters.end_date = end_date;
    if (limit) filters.limit = parseInt(limit);
    if (offset) filters.offset = parseInt(offset);
    if (sort_by) filters.sort_by = sort_by;
    if (sort_order) filters.sort_order = sort_order;

    const result = await getExecutions(filters);
    res.json(result);
  } catch (error) {
    logger.error('Error fetching executions:', error);
    res.status(500).json({ error: 'Failed to fetch executions', message: error.message });
  }
});

/**
 * GET /api/executions/stats
 * Get detailed execution statistics
 *
 * Returns:
 *   - active_count: Currently executing executions
 *   - waiting_approval_count: Executions waiting for approval
 *   - completed_today: Completed in last 24h
 *   - failed_today: Failed in last 24h
 *   - severity_breakdown: { critical, high, medium, low }
 */
router.get('/executions/stats', async (req, res) => {
  try {
    const stats = await getExecutionStatsDetailed();
    res.json(stats);
  } catch (error) {
    logger.error('Error fetching execution stats:', error);
    res.status(500).json({ error: 'Failed to fetch execution stats', message: error.message });
  }
});

/**
 * GET /api/executions/:id
 * Retrieve a specific execution
 */
router.get('/executions/:id', async (req, res) => {
  try {
    const execution = await getExecution(req.params.id);
    if (!execution) {
      return res.status(404).json({ error: 'Execution not found' });
    }
    res.json(execution);
  } catch (error) {
    logger.error('Error fetching execution:', error);
    res.status(500).json({ error: 'Failed to fetch execution', message: error.message });
  }
});

/**
 * POST /api/executions
 * Manually create/trigger an execution
 */
router.post('/executions', async (req, res) => {
  try {
    const { playbook_id, trigger_data, trigger_source } = req.body;

    if (!playbook_id || !trigger_data) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'playbook_id and trigger_data are required'
      });
    }

    const execution = await createExecution(playbook_id, trigger_data, trigger_source || 'manual');
    res.status(201).json(execution);
  } catch (error) {
    logger.error('Error creating execution:', error);
    res.status(500).json({ error: 'Failed to create execution', message: error.message });
  }
});

/**
 * PATCH /api/executions/:id/cancel
 * Cancel a running execution
 */
router.patch('/executions/:id/cancel', async (req, res) => {
  try {
    const userId = req.user?.email || 'system';
    const execution = await cancelExecution(req.params.id, userId);
    res.json(execution);
  } catch (error) {
    logger.error('Error cancelling execution:', error);
    res.status(500).json({ error: 'Failed to cancel execution', message: error.message });
  }
});

/**
 * GET /api/stats/executions
 * Get execution statistics
 */
router.get('/stats/executions', async (req, res) => {
  try {
    const { playbook_id, time_range } = req.query;
    const stats = await getExecutionStats(playbook_id, time_range || '24h');
    res.json(stats);
  } catch (error) {
    logger.error('Error fetching execution stats:', error);
    res.status(500).json({ error: 'Failed to fetch execution stats', message: error.message });
  }
});

// ============================================================================
// APPROVALS
// ============================================================================

/**
 * GET /api/approvals
 * Retrieve all approvals with filtering
 */
router.get('/approvals', async (req, res) => {
  try {
    const { status, execution_id, playbook_id, limit, offset } = req.query;
    const filters = {};
    if (status) filters.status = status;
    if (execution_id) filters.execution_id = execution_id;
    if (playbook_id) filters.playbook_id = playbook_id;
    if (limit) filters.limit = parseInt(limit);
    if (offset) filters.offset = parseInt(offset);

    const result = await getApprovals(filters);
    res.json(result);
  } catch (error) {
    logger.error('Error fetching approvals:', error);
    res.status(500).json({ error: 'Failed to fetch approvals', message: error.message });
  }
});

/**
 * GET /api/approvals/:id
 * Get single approval by ID
 */
router.get('/approvals/:id', async (req, res) => {
  try {
    const approval = await getApproval(req.params.id);
    if (!approval) {
      return res.status(404).json({ error: 'Approval not found' });
    }
    res.json(approval);
  } catch (error) {
    logger.error('Error fetching approval:', error);
    res.status(500).json({ error: 'Failed to fetch approval', message: error.message });
  }
});

/**
 * POST /api/approvals/:id/approve
 * Approve an action
 */
router.post('/approvals/:id/approve', async (req, res) => {
  try {
    const { note } = req.body;
    const userId = req.user?.email || 'analyst';
    const approval = await approveAction(req.params.id, userId, note);
    res.json(approval);
  } catch (error) {
    logger.error('Error approving action:', error);
    res.status(500).json({ error: 'Failed to approve action', message: error.message });
  }
});

/**
 * POST /api/approvals/:id/reject
 * Reject an action
 */
router.post('/approvals/:id/reject', async (req, res) => {
  try {
    const { note } = req.body;
    const userId = req.user?.email || 'analyst';
    const approval = await rejectAction(req.params.id, userId, note);
    res.json(approval);
  } catch (error) {
    logger.error('Error rejecting action:', error);
    res.status(500).json({ error: 'Failed to reject action', message: error.message });
  }
});

// ============================================================================
// CONNECTORS
// ============================================================================

/**
 * GET /api/connectors
 * Retrieve all connectors
 */
router.get('/connectors', async (req, res) => {
  try {
    const { type, status, tags } = req.query;
    const filters = {};
    if (type) filters.type = type;
    if (status) filters.status = status;
    if (tags) filters.tags = Array.isArray(tags) ? tags : [tags];

    const connectors = await getConnectors(filters);
    res.json(connectors);
  } catch (error) {
    logger.error('Error fetching connectors:', error);
    res.status(500).json({ error: 'Failed to fetch connectors', message: error.message });
  }
});

/**
 * GET /api/connectors/:id
 * Get single connector by ID
 */
router.get('/connectors/:id', async (req, res) => {
  try {
    const connector = await getConnector(req.params.id);
    if (!connector) {
      return res.status(404).json({ error: 'Connector not found' });
    }
    res.json(connector);
  } catch (error) {
    logger.error('Error fetching connector:', error);
    res.status(500).json({ error: 'Failed to fetch connector', message: error.message });
  }
});

/**
 * POST /api/connectors
 * Create a new connector
 */
router.post('/connectors', async (req, res) => {
  try {
    const userId = req.user?.email || 'system';
    const connector = await createConnector(req.body, userId);
    res.status(201).json(connector);
  } catch (error) {
    logger.error('Error creating connector:', error);
    res.status(500).json({ error: 'Failed to create connector', message: error.message });
  }
});

/**
 * PUT /api/connectors/:id
 * Update a connector
 */
router.put('/connectors/:id', async (req, res) => {
  try {
    const userId = req.user?.email || 'system';
    const connector = await updateConnector(req.params.id, req.body, userId);
    res.json(connector);
  } catch (error) {
    logger.error('Error updating connector:', error);
    res.status(500).json({ error: 'Failed to update connector', message: error.message });
  }
});

/**
 * PATCH /api/connectors/:id/toggle
 * Toggle connector enabled/disabled
 */
router.patch('/connectors/:id/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;
    const connector = await toggleConnector(req.params.id, enabled);
    res.json(connector);
  } catch (error) {
    logger.error('Error toggling connector:', error);
    res.status(500).json({ error: 'Failed to toggle connector', message: error.message });
  }
});

/**
 * DELETE /api/connectors/:id
 * Delete a connector
 */
router.delete('/connectors/:id', async (req, res) => {
  try {
    const userId = req.user?.email || 'system';
    await deleteConnector(req.params.id, userId);
    res.json({ success: true, id: req.params.id });
  } catch (error) {
    logger.error('Error deleting connector:', error);
    res.status(500).json({ error: 'Failed to delete connector', message: error.message });
  }
});

/**
 * POST /api/connectors/:id/test
 * Test connector connection or execute a real action for step testing.
 *
 * Body (optional):
 *   action     - Action type to execute (e.g., 'lookup_ip')
 *   parameters - Input parameters for the action (e.g., { ip: '8.8.8.8' })
 *
 * If action + parameters are provided, invokes the actual connector.
 * Otherwise, performs a simple health check.
 */
router.post('/connectors/:id/test', async (req, res) => {
  try {
    const { action, parameters } = req.body || {};
    const result = await testConnector(req.params.id, { action, parameters });
    res.json(result);
  } catch (error) {
    logger.error('Error testing connector:', error);
    res.status(500).json({ error: 'Failed to test connector', message: error.message });
  }
});

// ============================================================================
// AUDIT LOG
// ============================================================================

/**
 * GET /api/audit
 * Retrieve audit logs with filtering
 */
router.get('/audit', async (req, res) => {
  try {
    const {
      actor_email,
      action,
      resource_type,
      resource_id,
      outcome,
      start_date,
      end_date,
      limit,
      offset
    } = req.query;

    const filters = {};
    if (actor_email) filters.actor_email = actor_email;
    if (action) filters.action = action;
    if (resource_type) filters.resource_type = resource_type;
    if (resource_id) filters.resource_id = resource_id;
    if (outcome) filters.outcome = outcome;
    if (start_date) filters.start_date = start_date;
    if (end_date) filters.end_date = end_date;
    if (limit) filters.limit = parseInt(limit);
    if (offset) filters.offset = parseInt(offset);

    const result = await getAuditLogs(filters);
    res.json(result);
  } catch (error) {
    logger.error('Error fetching audit logs:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs', message: error.message });
  }
});

/**
 * GET /api/audit/resource/:type/:id
 * Get audit logs for a specific resource
 */
router.get('/audit/resource/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const { limit } = req.query;
    const logs = await getResourceAuditLogs(type, id, limit ? parseInt(limit) : 50);
    res.json(logs);
  } catch (error) {
    logger.error('Error fetching resource audit logs:', error);
    res.status(500).json({ error: 'Failed to fetch resource audit logs', message: error.message });
  }
});

/**
 * GET /api/stats/audit
 * Get audit log statistics
 */
router.get('/stats/audit', async (req, res) => {
  try {
    const { time_range } = req.query;
    const stats = await getAuditStats(time_range || '24h');
    res.json(stats);
  } catch (error) {
    logger.error('Error fetching audit stats:', error);
    res.status(500).json({ error: 'Failed to fetch audit stats', message: error.message });
  }
});

// ============================================================================
// METRICS
// ============================================================================

/**
 * GET /api/metrics
 * Retrieve SOAR metrics
 */
router.get('/metrics', async (req, res) => {
  try {
    const stats = await getExecutionStats(null, '24h');
    res.json({
      executions: {
        total: stats.total,
        executing: stats.executing,
        waiting_approval: stats.waiting_approval,
        completed: stats.completed,
        failed: stats.failed
      },
      success_rate: stats.success_rate,
      avg_duration_ms: stats.avg_duration_ms
    });
  } catch (error) {
    logger.error('Error fetching metrics:', error);
    res.status(500).json({ error: 'Failed to fetch metrics', message: error.message });
  }
});

export default router;
