/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.0 — CANONICAL TYPE DEFINITIONS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * THESE ARE THE ONLY VALID VALUES FOR STATE FIELDS.
 * Do NOT use any other values anywhere in the codebase.
 *
 * VERSION: 1.0.0
 * AUTHOR: CyberSentinel SOAR Team
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION STATES (CANONICAL)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Execution State Values
 *
 * ONLY THESE VALUES ARE VALID:
 * - EXECUTING: Currently running steps
 * - WAITING_APPROVAL: Paused waiting for human approval
 * - COMPLETED: Successfully finished all steps
 * - FAILED: Execution failed
 */
export const ExecutionState = Object.freeze({
  EXECUTING: 'EXECUTING',
  WAITING_APPROVAL: 'WAITING_APPROVAL',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED'
});

// ═══════════════════════════════════════════════════════════════════════════════
// STEP STATES (CANONICAL)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Step State Values
 *
 * ONLY THESE VALUES ARE VALID:
 * - PENDING: Not yet started
 * - EXECUTING: Currently running
 * - COMPLETED: Finished successfully
 * - FAILED: Step failed
 * - SKIPPED: Skipped (shadow mode or condition branch)
 */
export const StepState = Object.freeze({
  PENDING: 'PENDING',
  EXECUTING: 'EXECUTING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED'
});

// ═══════════════════════════════════════════════════════════════════════════════
// STEP TYPES (CANONICAL)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Step Type Values
 *
 * ONLY THESE VALUES ARE VALID:
 * - enrichment: Query threat intel sources
 * - condition: Evaluate branching logic
 * - approval: Pause for human decision
 * - action: Execute automated response (SKIPPED in shadow mode)
 * - notification: Send alerts to channels
 */
export const StepType = Object.freeze({
  ENRICHMENT: 'enrichment',
  CONDITION: 'condition',
  APPROVAL: 'approval',
  ACTION: 'action',
  NOTIFICATION: 'notification'
});

// ═══════════════════════════════════════════════════════════════════════════════
// APPROVAL STATUS (CANONICAL)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Approval Status Values
 */
export const ApprovalStatus = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired'
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTOR STATUS (CANONICAL)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Connector Status Values
 */
export const ConnectorStatus = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  ERROR: 'error',
  TESTING: 'testing'
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTOR HEALTH STATUS (CANONICAL)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Connector Health Status Values
 */
export const ConnectorHealthStatus = Object.freeze({
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNHEALTHY: 'unhealthy',
  UNKNOWN: 'unknown'
});

// ═══════════════════════════════════════════════════════════════════════════════
// ON_FAILURE BEHAVIORS (CANONICAL)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Step On-Failure Behavior Values
 */
export const OnFailureBehavior = Object.freeze({
  STOP: 'stop',       // Stop execution, mark FAILED
  CONTINUE: 'continue', // Log error, continue to next step
  RETRY: 'retry',     // Retry according to retry_policy
  SKIP: 'skip'        // Skip to end of playbook
});

// ═══════════════════════════════════════════════════════════════════════════════
// ON_SUCCESS BEHAVIORS (CANONICAL)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Step On-Success Behavior Values
 */
export const OnSuccessBehavior = Object.freeze({
  CONTINUE: 'continue',   // Continue to next sequential step
  GOTO: 'goto',           // Jump to specific step_id
  END: 'end'              // End execution successfully
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLAYBOOK STATUS (CANONICAL)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Playbook Status Values
 */
export const PlaybookStatus = Object.freeze({
  DRAFT: 'draft',
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  ARCHIVED: 'archived'
});

// ═══════════════════════════════════════════════════════════════════════════════
// TRIGGER TYPES (CANONICAL)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Playbook Trigger Type Values
 */
export const TriggerType = Object.freeze({
  WEBHOOK: 'webhook',
  MANUAL: 'manual',
  SCHEDULED: 'scheduled'
});

// ═══════════════════════════════════════════════════════════════════════════════
// SEVERITY LEVELS (CANONICAL)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Severity Level Values
 */
export const SeverityLevel = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONDITION OPERATORS (CANONICAL)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Condition Operator Values for DSL conditions
 */
export const ConditionOperator = Object.freeze({
  EQUALS: 'equals',
  NOT_EQUALS: 'not_equals',
  GREATER_THAN: 'greater_than',
  LESS_THAN: 'less_than',
  GREATER_OR_EQUAL: 'greater_or_equal',
  LESS_OR_EQUAL: 'less_or_equal',
  CONTAINS: 'contains',
  NOT_CONTAINS: 'not_contains',
  STARTS_WITH: 'starts_with',
  ENDS_WITH: 'ends_with',
  REGEX_MATCH: 'regex_match',
  IN: 'in',
  NOT_IN: 'not_in',
  EXISTS: 'exists',
  NOT_EXISTS: 'not_exists',
  IS_EMPTY: 'is_empty',
  IS_NOT_EMPTY: 'is_not_empty'
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTOR ERROR CODES (CANONICAL)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Connector Error Code Values
 */
export const ConnectorErrorCode = Object.freeze({
  // Retryable errors
  TIMEOUT: 'CONNECTOR_TIMEOUT',
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  RATE_LIMITED: 'RATE_LIMITED',

  // Non-retryable errors
  INVALID_INPUT: 'INVALID_INPUT',
  AUTH_FAILED: 'AUTH_FAILED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_ACTION: 'INVALID_ACTION',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED'
});

export default {
  ExecutionState,
  StepState,
  StepType,
  ApprovalStatus,
  ConnectorStatus,
  ConnectorHealthStatus,
  OnFailureBehavior,
  OnSuccessBehavior,
  PlaybookStatus,
  TriggerType,
  SeverityLevel,
  ConditionOperator,
  ConnectorErrorCode
};
