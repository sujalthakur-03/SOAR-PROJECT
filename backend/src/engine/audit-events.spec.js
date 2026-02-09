/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.0 — AUDIT & METRICS EVENTS SPECIFICATION
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * This specification defines ALL audit events and metrics counters
 * emitted by the Execution Engine.
 *
 * AUDIT EVENTS: For compliance, forensics, debugging
 * METRICS COUNTERS: For dashboards, alerting, capacity planning
 *
 * VERSION: 1.0.0
 * AUTHOR: CyberSentinel SOAR Team
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT EVENT DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * AUDIT EVENT SCHEMA
 *
 * Every audit event MUST contain:
 *
 * {
 *   timestamp: ISO8601 string (auto-generated)
 *   action: string (event type)
 *   resource_type: 'execution' | 'step' | 'approval' | 'playbook' | 'connector'
 *   resource_id: string (execution_id, step_id, etc.)
 *   resource_name: string (playbook name, step name)
 *   actor_email: string (user who triggered, or 'system')
 *   actor_role: string (role of actor)
 *   details: object (event-specific data)
 *   outcome: 'success' | 'failure'
 *   error_message: string | null
 *   session_id: string | null
 *   request_id: string | null
 * }
 */

export const AuditEvents = Object.freeze({
  // ───────────────────────────────────────────────────────────────────────────
  // EXECUTION LIFECYCLE EVENTS
  // ───────────────────────────────────────────────────────────────────────────

  EXECUTION_STARTED: {
    action: 'execution.started',
    description: 'Playbook execution has started',
    resource_type: 'execution',
    required_fields: ['playbook_id', 'playbook_name', 'shadow_mode'],
    emitted_when: 'Execution begins processing first step'
  },

  EXECUTION_COMPLETED: {
    action: 'execution.completed',
    description: 'Playbook execution completed successfully',
    resource_type: 'execution',
    required_fields: ['playbook_id', 'duration_ms', 'steps_executed', 'shadow_mode'],
    emitted_when: 'All steps completed or on_success=end reached'
  },

  EXECUTION_FAILED: {
    action: 'execution.failed',
    description: 'Playbook execution failed',
    resource_type: 'execution',
    required_fields: ['playbook_id', 'error', 'step_id', 'duration_ms'],
    emitted_when: 'Step fails with on_failure=stop or unhandled error'
  },

  EXECUTION_RESUMED: {
    action: 'execution.resumed',
    description: 'Execution resumed after approval',
    resource_type: 'execution',
    required_fields: ['approval_id', 'decision', 'decided_by'],
    emitted_when: 'Execution transitions from WAITING_APPROVAL to EXECUTING'
  },

  // ───────────────────────────────────────────────────────────────────────────
  // STEP LIFECYCLE EVENTS
  // ───────────────────────────────────────────────────────────────────────────

  STEP_STARTED: {
    action: 'step.started',
    description: 'Step execution has started',
    resource_type: 'step',
    required_fields: ['step_id', 'step_type', 'step_name'],
    emitted_when: 'Step state transitions to EXECUTING'
  },

  STEP_COMPLETED: {
    action: 'step.completed',
    description: 'Step execution completed successfully',
    resource_type: 'step',
    required_fields: ['step_id', 'step_type', 'duration_ms', 'shadow_mode'],
    emitted_when: 'Step state transitions to COMPLETED'
  },

  STEP_FAILED: {
    action: 'step.failed',
    description: 'Step execution failed',
    resource_type: 'step',
    required_fields: ['step_id', 'step_type', 'error', 'retry_count'],
    emitted_when: 'Step state transitions to FAILED (after retries exhausted)'
  },

  STEP_SKIPPED: {
    action: 'step.skipped',
    description: 'Step was skipped (condition or shadow mode)',
    resource_type: 'step',
    required_fields: ['step_id', 'step_type', 'skip_reason'],
    emitted_when: 'Step state transitions to SKIPPED'
  },

  STEP_RETRY: {
    action: 'step.retry',
    description: 'Step execution is being retried',
    resource_type: 'step',
    required_fields: ['step_id', 'step_type', 'retry_attempt', 'max_attempts', 'delay_seconds'],
    emitted_when: 'Retry policy triggers a retry attempt'
  },

  // ───────────────────────────────────────────────────────────────────────────
  // APPROVAL EVENTS
  // ───────────────────────────────────────────────────────────────────────────

  APPROVAL_REQUESTED: {
    action: 'approval.requested',
    description: 'Approval has been requested',
    resource_type: 'approval',
    required_fields: ['approval_id', 'step_id', 'approvers', 'timeout_hours'],
    emitted_when: 'Approval step creates pending approval'
  },

  APPROVAL_APPROVED: {
    action: 'approval.approved',
    description: 'Approval was granted',
    resource_type: 'approval',
    required_fields: ['approval_id', 'step_id', 'decided_by', 'decision_time_ms'],
    emitted_when: 'User approves the request'
  },

  APPROVAL_REJECTED: {
    action: 'approval.rejected',
    description: 'Approval was rejected',
    resource_type: 'approval',
    required_fields: ['approval_id', 'step_id', 'decided_by', 'rejection_reason'],
    emitted_when: 'User rejects the request'
  },

  APPROVAL_EXPIRED: {
    action: 'approval.expired',
    description: 'Approval timed out',
    resource_type: 'approval',
    required_fields: ['approval_id', 'step_id', 'timeout_hours'],
    emitted_when: 'Approval timeout reached without decision'
  },

  // ───────────────────────────────────────────────────────────────────────────
  // ACTION EVENTS (SHADOW MODE SPECIFIC)
  // ───────────────────────────────────────────────────────────────────────────

  ACTION_EXECUTED: {
    action: 'action.executed',
    description: 'Action step was executed',
    resource_type: 'step',
    required_fields: ['step_id', 'connector_id', 'action_type', 'duration_ms'],
    emitted_when: 'Action step completes successfully (not shadow mode)'
  },

  ACTION_SKIPPED_SHADOW: {
    action: 'action.skipped.shadow_mode',
    description: 'Action skipped due to shadow mode',
    resource_type: 'step',
    required_fields: ['step_id', 'connector_id', 'action_type', 'would_execute'],
    emitted_when: 'Action step encountered in shadow mode'
  },

  // ───────────────────────────────────────────────────────────────────────────
  // CONNECTOR EVENTS
  // ───────────────────────────────────────────────────────────────────────────

  CONNECTOR_INVOKED: {
    action: 'connector.invoked',
    description: 'Connector was invoked',
    resource_type: 'connector',
    required_fields: ['connector_id', 'action_type', 'duration_ms'],
    emitted_when: 'Connector action starts'
  },

  CONNECTOR_FAILED: {
    action: 'connector.failed',
    description: 'Connector invocation failed',
    resource_type: 'connector',
    required_fields: ['connector_id', 'action_type', 'error_code', 'retryable'],
    emitted_when: 'Connector returns error'
  },

  CONNECTOR_TIMEOUT: {
    action: 'connector.timeout',
    description: 'Connector invocation timed out',
    resource_type: 'connector',
    required_fields: ['connector_id', 'action_type', 'timeout_seconds'],
    emitted_when: 'Connector exceeds timeout_seconds'
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// METRICS COUNTER DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * METRICS COUNTER SCHEMA
 *
 * Counters are incremented via incrementMetric(name, labels)
 *
 * Labels allow dimensional breakdown:
 * - playbook_id: For per-playbook metrics
 * - step_type: For per-step-type metrics
 * - connector: For per-connector metrics
 * - outcome: 'success' | 'failure'
 */

export const MetricsCounters = Object.freeze({
  // ───────────────────────────────────────────────────────────────────────────
  // EXECUTION COUNTERS
  // ───────────────────────────────────────────────────────────────────────────

  EXECUTIONS_STARTED: {
    name: 'executions_started',
    description: 'Total number of executions started',
    labels: ['playbook_id', 'shadow_mode'],
    increment_when: 'New execution created'
  },

  EXECUTIONS_COMPLETED: {
    name: 'executions_completed',
    description: 'Total number of executions completed successfully',
    labels: ['playbook_id', 'shadow_mode'],
    increment_when: 'Execution reaches COMPLETED state'
  },

  EXECUTIONS_FAILED: {
    name: 'executions_failed',
    description: 'Total number of executions that failed',
    labels: ['playbook_id', 'failure_step'],
    increment_when: 'Execution reaches FAILED state'
  },

  // ───────────────────────────────────────────────────────────────────────────
  // STEP COUNTERS
  // ───────────────────────────────────────────────────────────────────────────

  STEPS_EXECUTED: {
    name: 'steps_executed',
    description: 'Total number of steps executed',
    labels: ['step_type', 'playbook_id'],
    increment_when: 'Step transitions to EXECUTING'
  },

  STEPS_COMPLETED: {
    name: 'steps_completed',
    description: 'Total number of steps completed',
    labels: ['step_type', 'playbook_id'],
    increment_when: 'Step transitions to COMPLETED'
  },

  STEPS_FAILED: {
    name: 'steps_failed',
    description: 'Total number of steps that failed',
    labels: ['step_type', 'playbook_id', 'error_code'],
    increment_when: 'Step transitions to FAILED'
  },

  STEP_RETRIES: {
    name: 'step_retries',
    description: 'Total number of step retry attempts',
    labels: ['step_type', 'playbook_id'],
    increment_when: 'Retry policy triggers retry'
  },

  // ───────────────────────────────────────────────────────────────────────────
  // ACTION COUNTERS
  // ───────────────────────────────────────────────────────────────────────────

  ACTIONS_EXECUTED: {
    name: 'actions_executed',
    description: 'Total number of actions executed (not shadow)',
    labels: ['connector_id', 'action_type'],
    increment_when: 'Action step executes (shadow_mode=false)'
  },

  ACTIONS_SKIPPED_SHADOW: {
    name: 'actions_skipped_shadow',
    description: 'Total number of actions skipped due to shadow mode',
    labels: ['connector_id', 'action_type'],
    increment_when: 'Action step skipped (shadow_mode=true)'
  },

  // ───────────────────────────────────────────────────────────────────────────
  // APPROVAL COUNTERS
  // ───────────────────────────────────────────────────────────────────────────

  APPROVALS_REQUESTED: {
    name: 'approvals_requested',
    description: 'Total number of approvals requested',
    labels: ['playbook_id'],
    increment_when: 'Approval step creates request'
  },

  APPROVALS_APPROVED: {
    name: 'approvals_approved',
    description: 'Total number of approvals granted',
    labels: ['playbook_id', 'approver_role'],
    increment_when: 'Approval decision = approved'
  },

  APPROVALS_REJECTED: {
    name: 'approvals_rejected',
    description: 'Total number of approvals rejected',
    labels: ['playbook_id', 'approver_role'],
    increment_when: 'Approval decision = rejected'
  },

  APPROVALS_EXPIRED: {
    name: 'approvals_expired',
    description: 'Total number of approvals that expired',
    labels: ['playbook_id'],
    increment_when: 'Approval timeout reached'
  },

  // ───────────────────────────────────────────────────────────────────────────
  // CONNECTOR COUNTERS
  // ───────────────────────────────────────────────────────────────────────────

  CONNECTOR_INVOCATIONS_SUCCESS: {
    name: 'connector_invocations_success',
    description: 'Successful connector invocations',
    labels: ['connector', 'action_type'],
    increment_when: 'Connector returns success'
  },

  CONNECTOR_INVOCATIONS_FAILED: {
    name: 'connector_invocations_failed',
    description: 'Failed connector invocations',
    labels: ['connector', 'action_type', 'error_code'],
    increment_when: 'Connector returns error'
  },

  CONNECTOR_TIMEOUTS: {
    name: 'connector_timeouts',
    description: 'Connector timeout occurrences',
    labels: ['connector', 'action_type'],
    increment_when: 'Connector exceeds timeout'
  },

  // ───────────────────────────────────────────────────────────────────────────
  // WEBHOOK COUNTERS (from forwarder)
  // ───────────────────────────────────────────────────────────────────────────

  WEBHOOKS_RECEIVED: {
    name: 'webhooks_received',
    description: 'Total webhooks received',
    labels: ['playbook_id'],
    increment_when: 'Webhook endpoint receives request'
  },

  WEBHOOKS_VALIDATED: {
    name: 'webhooks_validated',
    description: 'Webhooks that passed validation',
    labels: ['playbook_id'],
    increment_when: 'Webhook secret validated'
  },

  WEBHOOKS_REJECTED: {
    name: 'webhooks_rejected',
    description: 'Webhooks rejected (invalid secret/schema)',
    labels: ['playbook_id', 'rejection_reason'],
    increment_when: 'Webhook validation fails'
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// HISTOGRAMS (LATENCY DISTRIBUTIONS)
// ═══════════════════════════════════════════════════════════════════════════════

export const MetricsHistograms = Object.freeze({
  EXECUTION_DURATION_MS: {
    name: 'execution_duration_ms',
    description: 'Distribution of execution durations',
    labels: ['playbook_id', 'outcome'],
    buckets: [100, 500, 1000, 5000, 10000, 30000, 60000, 300000]
  },

  STEP_DURATION_MS: {
    name: 'step_duration_ms',
    description: 'Distribution of step durations',
    labels: ['step_type', 'playbook_id'],
    buckets: [10, 50, 100, 500, 1000, 5000, 10000, 30000]
  },

  CONNECTOR_LATENCY_MS: {
    name: 'connector_latency_ms',
    description: 'Distribution of connector response times',
    labels: ['connector', 'action_type'],
    buckets: [10, 50, 100, 500, 1000, 5000, 10000]
  },

  APPROVAL_DECISION_TIME_MS: {
    name: 'approval_decision_time_ms',
    description: 'Time from approval request to decision',
    labels: ['playbook_id', 'decision'],
    buckets: [60000, 300000, 900000, 1800000, 3600000] // 1min, 5min, 15min, 30min, 1hr
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT EVENT EXAMPLES
// ═══════════════════════════════════════════════════════════════════════════════

export const AuditEventExamples = {
  execution_started: {
    timestamp: '2026-01-17T10:30:00.000Z',
    action: 'execution.started',
    resource_type: 'execution',
    resource_id: 'EXE-20260117-A1B2C3',
    resource_name: 'SSH Brute Force Response',
    actor_email: 'system',
    actor_role: 'system',
    details: {
      playbook_id: 'PB-BRUTE-FORCE-001',
      playbook_name: 'SSH Brute Force Response',
      shadow_mode: false,
      trigger_source: 'webhook',
      source_ip: '192.168.1.100'
    },
    outcome: 'success',
    session_id: null,
    request_id: 'REQ-20260117-XYZ'
  },

  step_completed: {
    timestamp: '2026-01-17T10:30:05.000Z',
    action: 'step.completed',
    resource_type: 'step',
    resource_id: 'enrich_source_ip',
    resource_name: 'Enrich Source IP',
    actor_email: 'system',
    actor_role: 'system',
    details: {
      execution_id: 'EXE-20260117-A1B2C3',
      playbook_id: 'PB-BRUTE-FORCE-001',
      step_id: 'enrich_source_ip',
      step_type: 'enrichment',
      duration_ms: 1250,
      shadow_mode: false
    },
    outcome: 'success'
  },

  action_skipped_shadow: {
    timestamp: '2026-01-17T10:30:10.000Z',
    action: 'action.skipped.shadow_mode',
    resource_type: 'step',
    resource_id: 'block_ip',
    resource_name: 'Block Source IP',
    actor_email: 'system',
    actor_role: 'system',
    details: {
      execution_id: 'EXE-20260117-A1B2C3',
      playbook_id: 'PB-BRUTE-FORCE-001',
      step_id: 'block_ip',
      step_type: 'action',
      connector_id: 'firewall-01',
      action_type: 'block_ip',
      would_execute: {
        ip_address: '192.168.1.100',
        duration: '24h'
      }
    },
    outcome: 'success'
  },

  approval_requested: {
    timestamp: '2026-01-17T10:30:08.000Z',
    action: 'approval.requested',
    resource_type: 'approval',
    resource_id: 'APR-20260117-DEFGH',
    resource_name: 'Approve IP Block',
    actor_email: 'system',
    actor_role: 'system',
    details: {
      execution_id: 'EXE-20260117-A1B2C3',
      playbook_id: 'PB-BRUTE-FORCE-001',
      approval_id: 'APR-20260117-DEFGH',
      step_id: 'approve_block',
      approvers: ['role:soc_analyst', 'role:soc_manager'],
      timeout_hours: 1,
      context: {
        source_ip: '192.168.1.100',
        abuse_score: 95
      }
    },
    outcome: 'success'
  }
};

export default {
  AuditEvents,
  MetricsCounters,
  MetricsHistograms,
  AuditEventExamples
};
