/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.x — SOC METRICS & SLA API ROUTES
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Analyst-facing API endpoints for SOC metrics, KPIs, and SLA monitoring.
 * All endpoints are READ-ONLY and optimized for fast response (<200ms typical).
 *
 * ENDPOINTS:
 * ─────────────────────────────────────────────────────────────────────────────
 * GET /api/soc/overview          - SOC health dashboard data
 * GET /api/soc/kpis              - All KPIs with time windows
 * GET /api/soc/metrics/mtta      - MTTA metrics
 * GET /api/soc/metrics/mttr      - MTTR metrics
 * GET /api/soc/metrics/success   - Success rate metrics
 * GET /api/soc/metrics/automation - Automation coverage
 * GET /api/soc/metrics/approval  - Approval latency metrics
 * GET /api/soc/backlog           - Current execution backlog
 * GET /api/soc/throughput        - Alert throughput
 * GET /api/soc/sla/status        - SLA compliance status
 * GET /api/soc/sla/breaches      - SLA breach list
 * GET /api/soc/sla/policies      - SLA policy list
 * GET /api/soc/playbooks/:id/performance - Per-playbook metrics
 * GET /api/soc/executions/:id/timeline - Execution timeline drill-down
 * GET /api/soc/health/alerts     - SOC health alerts
 *
 * VERSION: 1.0.0
 * AUTHOR: SOC Metrics & SLA Architect
 * ══════════════════════════════════════════════════════════════════════════════
 */

import express from 'express';
import socMetricsService from '../services/soc-metrics-service.js';
import slaEnforcementService from '../services/sla-enforcement-service.js';
import SLAPolicy from '../models/sla-policy.js';
import SOCHealthAlert, { AlertStatus } from '../models/soc-health-alert.js';
import Execution from '../models/execution.js';
import logger from '../utils/logger.js';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════════
// SOC DASHBOARD & OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/soc/overview
 * Get comprehensive SOC health dashboard data
 *
 * Query params:
 *   - window: Time window (5m, 15m, 1h, 4h, 24h, 7d, 30d) - default: 24h
 */
router.get('/overview', async (req, res) => {
  try {
    const window = req.query.window || '24h';

    const [kpis, backlog, slaStatus, healthAlerts] = await Promise.all([
      socMetricsService.getSOCKPIs(window),
      socMetricsService.getBacklog(),
      slaEnforcementService.getSLAStatus(),
      SOCHealthAlert.getActive({ severity: 'critical' })
    ]);

    res.json({
      timestamp: new Date().toISOString(),
      window,
      kpis,
      backlog,
      sla_status: slaStatus,
      critical_alerts: healthAlerts.slice(0, 5) // Top 5 critical alerts
    });
  } catch (error) {
    logger.error('Error fetching SOC overview:', error);
    res.status(500).json({ error: 'Failed to fetch SOC overview', message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMPREHENSIVE KPIs
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/soc/kpis
 * Get all SOC KPIs with time windows
 *
 * Query params:
 *   - window: Time window (5m, 15m, 1h, 4h, 24h, 7d, 30d) - default: 24h
 *   - playbook_id: Optional playbook filter
 *   - severity: Optional severity filter
 */
router.get('/kpis', async (req, res) => {
  try {
    const window = req.query.window || '24h';
    const kpis = await socMetricsService.getSOCKPIs(window);

    res.json(kpis);
  } catch (error) {
    logger.error('Error fetching SOC KPIs:', error);
    res.status(500).json({ error: 'Failed to fetch SOC KPIs', message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// INDIVIDUAL METRICS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/soc/metrics/mtta
 * Get Mean Time To Acknowledge metrics
 */
router.get('/metrics/mtta', async (req, res) => {
  try {
    const filters = {
      window: req.query.window || '24h',
      playbook_id: req.query.playbook_id,
      severity: req.query.severity
    };

    const mtta = await socMetricsService.calculateMTTA(filters);
    res.json(mtta);
  } catch (error) {
    logger.error('Error calculating MTTA:', error);
    res.status(500).json({ error: 'Failed to calculate MTTA', message: error.message });
  }
});

/**
 * GET /api/soc/metrics/mttr
 * Get Mean Time To Respond/Resolve metrics
 */
router.get('/metrics/mttr', async (req, res) => {
  try {
    const filters = {
      window: req.query.window || '24h',
      playbook_id: req.query.playbook_id,
      severity: req.query.severity
    };

    const mttr = await socMetricsService.calculateMTTR(filters);
    res.json(mttr);
  } catch (error) {
    logger.error('Error calculating MTTR:', error);
    res.status(500).json({ error: 'Failed to calculate MTTR', message: error.message });
  }
});

/**
 * GET /api/soc/metrics/success
 * Get execution success rate metrics
 */
router.get('/metrics/success', async (req, res) => {
  try {
    const filters = {
      window: req.query.window || '24h',
      playbook_id: req.query.playbook_id,
      severity: req.query.severity
    };

    const successRate = await socMetricsService.calculateSuccessRate(filters);
    res.json(successRate);
  } catch (error) {
    logger.error('Error calculating success rate:', error);
    res.status(500).json({ error: 'Failed to calculate success rate', message: error.message });
  }
});

/**
 * GET /api/soc/metrics/automation
 * Get automation coverage metrics
 */
router.get('/metrics/automation', async (req, res) => {
  try {
    const filters = {
      window: req.query.window || '24h',
      playbook_id: req.query.playbook_id
    };

    const automation = await socMetricsService.calculateAutomationCoverage(filters);
    res.json(automation);
  } catch (error) {
    logger.error('Error calculating automation coverage:', error);
    res.status(500).json({ error: 'Failed to calculate automation coverage', message: error.message });
  }
});

/**
 * GET /api/soc/metrics/approval
 * Get approval latency metrics
 */
router.get('/metrics/approval', async (req, res) => {
  try {
    const window = req.query.window || '24h';
    const approvalLatency = await socMetricsService.calculateApprovalLatency(window);
    res.json(approvalLatency);
  } catch (error) {
    logger.error('Error calculating approval latency:', error);
    res.status(500).json({ error: 'Failed to calculate approval latency', message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// BACKLOG & THROUGHPUT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/soc/backlog
 * Get current execution backlog
 */
router.get('/backlog', async (req, res) => {
  try {
    const backlog = await socMetricsService.getBacklog();
    res.json(backlog);
  } catch (error) {
    logger.error('Error fetching backlog:', error);
    res.status(500).json({ error: 'Failed to fetch backlog', message: error.message });
  }
});

/**
 * GET /api/soc/throughput
 * Get alert throughput (executions per minute)
 */
router.get('/throughput', async (req, res) => {
  try {
    const filters = {
      window: req.query.window || '1h'
    };

    const throughput = await socMetricsService.calculateThroughput(filters);
    res.json(throughput);
  } catch (error) {
    logger.error('Error calculating throughput:', error);
    res.status(500).json({ error: 'Failed to calculate throughput', message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SLA MONITORING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/soc/sla/status
 * Get SLA compliance status
 */
router.get('/sla/status', async (req, res) => {
  try {
    const status = await slaEnforcementService.getSLAStatus();
    res.json(status);
  } catch (error) {
    logger.error('Error fetching SLA status:', error);
    res.status(500).json({ error: 'Failed to fetch SLA status', message: error.message });
  }
});

/**
 * GET /api/soc/sla/breaches
 * Get list of SLA breaches
 *
 * Query params:
 *   - window: Time window (1h, 4h, 24h, 7d) - default: 24h
 *   - playbook_id: Optional playbook filter
 *   - severity: Optional severity filter
 *   - limit: Max results (default: 100)
 */
router.get('/sla/breaches', async (req, res) => {
  try {
    const filters = {
      window: req.query.window || '24h',
      playbook_id: req.query.playbook_id,
      severity: req.query.severity,
      limit: parseInt(req.query.limit) || 100
    };

    const breaches = await slaEnforcementService.getSLABreaches(filters);
    res.json({
      window: filters.window,
      count: breaches.length,
      breaches
    });
  } catch (error) {
    logger.error('Error fetching SLA breaches:', error);
    res.status(500).json({ error: 'Failed to fetch SLA breaches', message: error.message });
  }
});

/**
 * GET /api/soc/sla/policies
 * Get list of SLA policies
 *
 * Query params:
 *   - enabled: Filter by enabled status (true/false)
 */
router.get('/sla/policies', async (req, res) => {
  try {
    const query = {};

    if (req.query.enabled !== undefined) {
      query.enabled = req.query.enabled === 'true';
    }

    const policies = await SLAPolicy.find(query)
      .sort({ priority: 1 })
      .lean();

    res.json({
      count: policies.length,
      policies: policies.map(p => ({
        policy_id: p.policy_id,
        name: p.name,
        scope: p.scope,
        playbook_id: p.playbook_id,
        severity: p.severity,
        thresholds: p.thresholds,
        enabled: p.enabled,
        created_at: p.created_at
      }))
    });
  } catch (error) {
    logger.error('Error fetching SLA policies:', error);
    res.status(500).json({ error: 'Failed to fetch SLA policies', message: error.message });
  }
});

/**
 * POST /api/soc/sla/policies
 * Create a new SLA policy
 */
router.post('/sla/policies', async (req, res) => {
  try {
    const userId = req.user?.email || 'system';
    const { name, description, scope, playbook_id, severity, thresholds } = req.body;

    // Validate required fields
    if (!name || !scope || !thresholds) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'name, scope, and thresholds are required'
      });
    }

    const policy = new SLAPolicy({
      policy_id: SLAPolicy.generatePolicyId(scope, playbook_id || severity || 'DEFAULT'),
      name,
      description,
      scope,
      playbook_id,
      severity,
      thresholds,
      enabled: true,
      created_by: userId
    });

    await policy.save();

    logger.info(`Created SLA policy ${policy.policy_id} by ${userId}`);

    res.status(201).json(policy.toSummary());
  } catch (error) {
    logger.error('Error creating SLA policy:', error);
    res.status(500).json({ error: 'Failed to create SLA policy', message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PER-PLAYBOOK PERFORMANCE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/soc/playbooks/:id/performance
 * Get performance metrics for a specific playbook
 *
 * Query params:
 *   - window: Time window (default: 24h)
 */
router.get('/playbooks/:id/performance', async (req, res) => {
  try {
    const playbookId = req.params.id;
    const window = req.query.window || '24h';

    const performance = await socMetricsService.getPlaybookPerformance(playbookId, window);
    res.json(performance);
  } catch (error) {
    logger.error(`Error fetching playbook performance for ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to fetch playbook performance', message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION TIMELINE (DRILL-DOWN)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/soc/executions/:id/timeline
 * Get detailed execution timeline for drill-down analysis
 */
router.get('/executions/:id/timeline', async (req, res) => {
  try {
    const executionId = req.params.id;

    // Find execution (supports both execution_id and MongoDB _id)
    let execution = await Execution.findOne({ execution_id: executionId });

    if (!execution && executionId.match(/^[0-9a-fA-F]{24}$/)) {
      execution = await Execution.findById(executionId);
    }

    if (!execution) {
      return res.status(404).json({ error: 'Execution not found' });
    }

    // Build timeline events
    const timeline = [];

    // Webhook received
    if (execution.webhook_received_at) {
      timeline.push({
        timestamp: execution.webhook_received_at,
        event: 'webhook_received',
        description: 'Alert webhook received',
        duration_ms: null
      });
    }

    // Execution acknowledged (created)
    if (execution.acknowledged_at) {
      const mtta = execution.acknowledged_at - execution.webhook_received_at;
      timeline.push({
        timestamp: execution.acknowledged_at,
        event: 'execution_acknowledged',
        description: 'Execution record created',
        duration_ms: mtta,
        sla_check: {
          dimension: 'acknowledge',
          threshold_ms: execution.sla_status?.acknowledge?.threshold_ms,
          breached: execution.sla_status?.acknowledge?.breached
        }
      });
    }

    // Execution started
    if (execution.started_at) {
      timeline.push({
        timestamp: execution.started_at,
        event: 'execution_started',
        description: 'Playbook execution started',
        duration_ms: null
      });
    }

    // Step-by-step execution
    if (execution.steps && execution.steps.length > 0) {
      execution.steps.forEach((step, index) => {
        if (step.started_at) {
          timeline.push({
            timestamp: step.started_at,
            event: 'step_started',
            step_id: step.step_id,
            step_index: index,
            description: `Step ${step.step_id} started`,
            duration_ms: null
          });
        }

        if (step.completed_at) {
          timeline.push({
            timestamp: step.completed_at,
            event: 'step_completed',
            step_id: step.step_id,
            step_index: index,
            state: step.state,
            description: `Step ${step.step_id} ${step.state.toLowerCase()}`,
            duration_ms: step.duration_ms,
            error: step.error
          });
        }
      });
    }

    // Containment action
    if (execution.containment_at) {
      const mttc = execution.containment_at - execution.started_at;
      timeline.push({
        timestamp: execution.containment_at,
        event: 'containment_action',
        description: 'First containment action executed',
        duration_ms: mttc,
        sla_check: {
          dimension: 'containment',
          threshold_ms: execution.sla_status?.containment?.threshold_ms,
          breached: execution.sla_status?.containment?.breached
        }
      });
    }

    // Execution completed
    if (execution.completed_at) {
      const mttr = execution.duration_ms;
      timeline.push({
        timestamp: execution.completed_at,
        event: 'execution_completed',
        state: execution.state,
        description: `Execution ${execution.state.toLowerCase()}`,
        duration_ms: mttr,
        sla_check: {
          dimension: 'resolution',
          threshold_ms: execution.sla_status?.resolution?.threshold_ms,
          breached: execution.sla_status?.resolution?.breached
        }
      });
    }

    // Sort timeline by timestamp
    timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    res.json({
      execution_id: execution.execution_id,
      playbook_id: execution.playbook_id,
      playbook_name: execution.playbook_name,
      state: execution.state,
      sla_policy_id: execution.sla_policy_id,
      sla_status: execution.sla_status,
      timeline
    });
  } catch (error) {
    logger.error(`Error fetching execution timeline for ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to fetch execution timeline', message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SOC HEALTH ALERTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/soc/health/alerts
 * Get SOC health alerts
 *
 * Query params:
 *   - status: Filter by status (active, acknowledged, resolved)
 *   - type: Filter by alert type
 *   - severity: Filter by severity
 *   - limit: Max results (default: 50)
 */
router.get('/health/alerts', async (req, res) => {
  try {
    const filters = {};

    if (req.query.type) filters.type = req.query.type;
    if (req.query.severity) filters.severity = req.query.severity;

    let query = {};

    if (req.query.status) {
      query.status = req.query.status;
    } else {
      // Default: show active and acknowledged alerts
      query.status = { $in: [AlertStatus.ACTIVE, AlertStatus.ACKNOWLEDGED] };
    }

    if (filters.type) query.type = filters.type;
    if (filters.severity) query.severity = filters.severity;

    const limit = parseInt(req.query.limit) || 50;

    const alerts = await SOCHealthAlert.find(query)
      .sort({ severity: 1, created_at: -1 })
      .limit(limit)
      .lean();

    res.json({
      count: alerts.length,
      alerts
    });
  } catch (error) {
    logger.error('Error fetching SOC health alerts:', error);
    res.status(500).json({ error: 'Failed to fetch SOC health alerts', message: error.message });
  }
});

/**
 * POST /api/soc/health/alerts/:id/acknowledge
 * Acknowledge a SOC health alert
 */
router.post('/health/alerts/:id/acknowledge', async (req, res) => {
  try {
    const userId = req.user?.email || 'analyst';
    const note = req.body.note || '';

    const alert = await SOCHealthAlert.findOne({ alert_id: req.params.id });

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    await alert.acknowledge(userId, note);

    logger.info(`SOC health alert ${alert.alert_id} acknowledged by ${userId}`);

    res.json({
      success: true,
      alert_id: alert.alert_id,
      status: alert.status
    });
  } catch (error) {
    logger.error(`Error acknowledging alert ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to acknowledge alert', message: error.message });
  }
});

/**
 * POST /api/soc/health/alerts/:id/resolve
 * Resolve a SOC health alert
 */
router.post('/health/alerts/:id/resolve', async (req, res) => {
  try {
    const userId = req.user?.email || 'analyst';
    const note = req.body.note || '';

    const alert = await SOCHealthAlert.findOne({ alert_id: req.params.id });

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    await alert.resolve(userId, note);

    logger.info(`SOC health alert ${alert.alert_id} resolved by ${userId}`);

    res.json({
      success: true,
      alert_id: alert.alert_id,
      status: alert.status
    });
  } catch (error) {
    logger.error(`Error resolving alert ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to resolve alert', message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

export default router;
