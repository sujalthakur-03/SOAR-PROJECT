/**
 * ══════════════════════════════════════════════════════════════════════════════
 * CYBERSENTINEL SOAR v3.0 — PLAYBOOK DSL SPECIFICATION (HARDENED)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * This specification defines the STRICT, DECLARATIVE DSL for playbook steps.
 * NO scripting. NO arbitrary code. DECLARATIVE ONLY.
 *
 * HARDENING RULES (MANDATORY):
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 1. CONDITION STEP TERMINATION:
 *    - Condition steps MUST define BOTH on_true AND on_false
 *    - NO implicit fall-through to next step index
 *    - Validation FAILS if either is missing
 *    - Use '__END__' to explicitly end execution
 *
 * 2. EXECUTION LOOP PROTECTION:
 *    - Hard limit: MAX_STEP_EXECUTIONS = 100 per execution
 *    - Prevents infinite loops from circular goto/branching
 *    - On breach: execution FAILS with error code 'LOOP_DETECTED'
 *
 * 3. APPROVAL TIMEOUT SEMANTICS:
 *    - Approval steps MUST define on_timeout explicitly
 *    - Allowed values: 'fail', 'continue', 'skip', or a valid step_id
 *    - NO default behavior - validation FAILS if missing
 *
 * VERSION: 1.1.0 (HARDENED)
 * AUTHOR: CyberSentinel SOAR Team
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// HARDENING CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Special step ID to explicitly end execution.
 * Use this in on_true, on_false, on_timeout to terminate the playbook.
 */
export const STEP_END = '__END__';

/**
 * Maximum step executions per execution to prevent infinite loops.
 * If exceeded, execution FAILS with error code LOOP_DETECTED.
 */
export const MAX_STEP_EXECUTIONS = 100;

/**
 * Valid approval timeout behaviors.
 * on_timeout MUST be one of these values or a valid step_id.
 */
export const VALID_APPROVAL_TIMEOUT_BEHAVIORS = Object.freeze([
  'fail',     // Execution state → FAILED
  'continue', // Continue to next step
  'skip'      // End execution successfully
]);

// ═══════════════════════════════════════════════════════════════════════════════
// CANONICAL STEP TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export const StepType = Object.freeze({
  ENRICHMENT: 'enrichment',
  CONDITION: 'condition',
  APPROVAL: 'approval',
  ACTION: 'action',
  NOTIFICATION: 'notification'
});

// ═══════════════════════════════════════════════════════════════════════════════
// CANONICAL STEP STATES
// ═══════════════════════════════════════════════════════════════════════════════

export const StepState = Object.freeze({
  PENDING: 'PENDING',
  EXECUTING: 'EXECUTING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED'  // Used in shadow mode or condition branching
});

// ═══════════════════════════════════════════════════════════════════════════════
// CANONICAL EXECUTION STATES
// ═══════════════════════════════════════════════════════════════════════════════

export const ExecutionState = Object.freeze({
  EXECUTING: 'EXECUTING',
  WAITING_APPROVAL: 'WAITING_APPROVAL',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED'
});

// ═══════════════════════════════════════════════════════════════════════════════
// ON_FAILURE BEHAVIORS
// ═══════════════════════════════════════════════════════════════════════════════

export const OnFailureBehavior = Object.freeze({
  STOP: 'stop',       // Stop execution, mark FAILED
  CONTINUE: 'continue', // Log error, continue to next step
  RETRY: 'retry',     // Retry according to retry_policy
  SKIP: 'skip'        // Skip remaining steps in current branch
});

// ═══════════════════════════════════════════════════════════════════════════════
// ON_SUCCESS BEHAVIORS
// ═══════════════════════════════════════════════════════════════════════════════

export const OnSuccessBehavior = Object.freeze({
  CONTINUE: 'continue',   // Continue to next sequential step
  GOTO: 'goto',           // Jump to specific step_id
  END: 'end'              // End execution successfully
});

// ═══════════════════════════════════════════════════════════════════════════════
// STEP BASE SCHEMA (REQUIRED FOR ALL STEPS)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Base Step Schema
 *
 * Every step MUST include these fields:
 *
 * @typedef {Object} BaseStep
 * @property {string} step_id - Unique identifier within playbook (e.g., "step_001")
 * @property {string} name - Human-readable step name
 * @property {StepType} type - One of: enrichment, condition, approval, action, notification
 * @property {number} timeout_seconds - Maximum execution time (default: 300)
 * @property {OnSuccessBehavior|Object} on_success - Behavior on success
 * @property {OnFailureBehavior} on_failure - Behavior on failure
 * @property {RetryPolicy} [retry_policy] - Optional retry configuration
 * @property {InputMapping} input - Input field mappings
 */

export const BaseStepSchema = {
  step_id: { type: 'string', required: true, pattern: /^[a-z][a-z0-9_]*$/ },
  name: { type: 'string', required: true },
  type: { type: 'enum', values: Object.values(StepType), required: true },
  timeout_seconds: { type: 'number', default: 300, min: 1, max: 86400 },
  on_success: { type: 'object|string', required: true },
  on_failure: { type: 'enum', values: Object.values(OnFailureBehavior), required: true },
  retry_policy: { type: 'object', required: false },
  input: { type: 'object', required: true }
};

// ═══════════════════════════════════════════════════════════════════════════════
// RETRY POLICY SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Retry Policy Schema
 *
 * @typedef {Object} RetryPolicy
 * @property {boolean} enabled - Enable retry
 * @property {number} max_attempts - Maximum retry attempts (1-10)
 * @property {number} delay_seconds - Initial delay between retries
 * @property {number} backoff_multiplier - Multiplier for exponential backoff (1.0-5.0)
 * @property {number} max_delay_seconds - Maximum delay cap
 */

export const RetryPolicySchema = {
  enabled: { type: 'boolean', default: false },
  max_attempts: { type: 'number', default: 3, min: 1, max: 10 },
  delay_seconds: { type: 'number', default: 5, min: 1, max: 300 },
  backoff_multiplier: { type: 'number', default: 2.0, min: 1.0, max: 5.0 },
  max_delay_seconds: { type: 'number', default: 60, min: 1, max: 600 }
};

// ═══════════════════════════════════════════════════════════════════════════════
// INPUT MAPPING SPECIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Input Mapping Sources (Declarative Only)
 *
 * Inputs can only come from:
 * 1. trigger_data.<path>   - Original alert payload (immutable)
 * 2. steps.<step_id>.output.<path> - Output from previous step
 * 3. playbook.<field>      - Playbook configuration
 * 4. literal:<value>       - Literal value
 *
 * NO expressions. NO code. PURE mapping.
 */

export const InputMappingPrefix = Object.freeze({
  TRIGGER: 'trigger_data',      // From original alert
  STEPS: 'steps',               // From step outputs
  PLAYBOOK: 'playbook',         // From playbook config
  LITERAL: 'literal'            // Literal value
});

/**
 * Example input mapping:
 *
 * input: {
 *   "ip_address": "trigger_data.data.source_ip",
 *   "severity": "trigger_data.severity",
 *   "reputation_score": "steps.enrich_ip.output.abuse_score",
 *   "timeout": "literal:30"
 * }
 */

// ═══════════════════════════════════════════════════════════════════════════════
// STEP TYPE: ENRICHMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Enrichment Step Schema
 *
 * Queries external threat intelligence sources for context.
 *
 * @typedef {Object} EnrichmentStep
 * @property {string} connector_id - Connector to use (e.g., "virustotal", "abuseipdb")
 * @property {string} action_type - Connector action (e.g., "lookup_ip", "scan_hash")
 * @property {InputMapping} input - Mapped inputs
 */

export const EnrichmentStepExample = {
  step_id: "enrich_source_ip",
  name: "Enrich Source IP via AbuseIPDB",
  type: "enrichment",
  timeout_seconds: 30,
  on_success: { behavior: "continue" },
  on_failure: "continue",  // Enrichment failure shouldn't stop execution
  retry_policy: {
    enabled: true,
    max_attempts: 3,
    delay_seconds: 2,
    backoff_multiplier: 2.0,
    max_delay_seconds: 10
  },
  connector_id: "abuseipdb",
  action_type: "lookup_ip",
  input: {
    ip_address: "trigger_data.data.source_ip"
  },
  output_mapping: {
    abuse_score: "$.abuseConfidenceScore",
    country_code: "$.countryCode",
    is_public: "$.isPublic"
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// STEP TYPE: CONDITION (HARDENED)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Condition Step Schema
 *
 * Evaluates a declarative condition to determine branching.
 * NO arbitrary expressions. ONLY field comparisons.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * HARDENING RULE: CONDITION STEPS ARE TERMINAL
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * - Condition steps MUST always branch via on_true OR on_false
 * - BOTH on_true and on_false are MANDATORY
 * - NO implicit fall-through to next step index
 * - Validation FAILS if either is missing
 * - Use '__END__' to explicitly terminate execution
 *
 * VALID:
 *   { on_true: "block_ip", on_false: "notify_analyst" }
 *   { on_true: "action_step", on_false: "__END__" }
 *
 * INVALID (will fail validation):
 *   { on_true: "block_ip" }  // Missing on_false
 *   { on_false: "notify" }   // Missing on_true
 *   {}                       // Missing both
 *
 * @typedef {Object} ConditionStep
 * @property {Object} condition - Condition to evaluate
 * @property {string} condition.field - Field path to evaluate
 * @property {string} condition.operator - Comparison operator
 * @property {*} condition.value - Value to compare against
 * @property {string} on_true - Step ID to jump to if true (MANDATORY)
 * @property {string} on_false - Step ID to jump to if false (MANDATORY)
 */

export const ConditionOperators = Object.freeze({
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
  IN: 'in',           // Value is in array
  NOT_IN: 'not_in',   // Value not in array
  EXISTS: 'exists',   // Field exists
  NOT_EXISTS: 'not_exists'
});

export const ConditionStepExample = {
  step_id: "check_abuse_score",
  name: "Check if IP is Malicious",
  type: "condition",
  timeout_seconds: 5,
  on_success: { behavior: "continue" },  // Condition always "succeeds"
  on_failure: "stop",
  condition: {
    field: "steps.enrich_source_ip.output.abuse_score",
    operator: "greater_than",
    value: 80
  },
  // HARDENING: BOTH on_true and on_false are MANDATORY
  on_true: "block_ip",       // Jump to block_ip step if score > 80
  on_false: "notify_analyst" // Jump to notify_analyst step if score <= 80
  // NOTE: Use "__END__" to explicitly end execution:
  // on_false: "__END__" // End execution if score is low
};

// ═══════════════════════════════════════════════════════════════════════════════
// STEP TYPE: APPROVAL (HARDENED)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Approval Step Schema
 *
 * Pauses execution until human approves/rejects.
 * Execution state becomes WAITING_APPROVAL.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * HARDENING RULE: on_timeout IS MANDATORY
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * - on_timeout MUST be explicitly defined (NO default behavior)
 * - Allowed values: 'fail', 'continue', 'skip', or a valid step_id
 * - Validation FAILS if on_timeout is missing
 *
 * BEHAVIOR:
 *   - 'fail': Execution state → FAILED, error code APPROVAL_TIMEOUT
 *   - 'continue': Continue to next step after approval step
 *   - 'skip': End execution successfully (state → COMPLETED)
 *   - step_id: Jump to specified step
 *
 * VALID:
 *   { on_timeout: "fail" }           // Fail on timeout
 *   { on_timeout: "continue" }       // Skip approval, continue execution
 *   { on_timeout: "skip" }           // End execution successfully
 *   { on_timeout: "notify_timeout" } // Jump to notification step
 *
 * INVALID (will fail validation):
 *   {}                               // Missing on_timeout
 *   { on_timeout: "ignore" }         // Invalid value
 *
 * @typedef {Object} ApprovalStep
 * @property {string[]} approvers - List of user IDs or roles who can approve
 * @property {string} message - Message shown to approver
 * @property {number} timeout_hours - Hours before auto-expiration
 * @property {string} on_approved - Step ID to continue on approval
 * @property {string} on_rejected - Behavior on rejection: 'fail', 'stop', or step_id
 * @property {string} on_timeout - Behavior on timeout: 'fail', 'continue', 'skip', or step_id (MANDATORY)
 */

export const ApprovalStepExample = {
  step_id: "approve_block",
  name: "Approve IP Block",
  type: "approval",
  timeout_seconds: 3600,  // Approval timeout in seconds (1 hour)
  on_success: { behavior: "continue" },
  on_failure: "stop",
  approvers: ["role:soc_analyst", "role:soc_manager"],
  message: "Approve blocking IP {{trigger_data.data.source_ip}} with abuse score {{steps.enrich_source_ip.output.abuse_score}}?",
  input: {
    source_ip: "trigger_data.data.source_ip",
    abuse_score: "steps.enrich_source_ip.output.abuse_score",
    agent_name: "trigger_data.agent.name"
  },
  timeout_hours: 1,
  on_approved: "block_ip",
  on_rejected: "stop",
  on_timeout: "stop"
};

// ═══════════════════════════════════════════════════════════════════════════════
// STEP TYPE: ACTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Action Step Schema
 *
 * Executes automated response via connector.
 * SHADOW MODE: Actions are SKIPPED (not executed) in shadow mode.
 *
 * @typedef {Object} ActionStep
 * @property {string} connector_id - Connector to use
 * @property {string} action_type - Action to perform
 * @property {InputMapping} input - Action parameters
 * @property {boolean} requires_approval - Whether this action needs prior approval
 */

export const ActionStepExample = {
  step_id: "block_ip",
  name: "Block Source IP on Firewall",
  type: "action",
  timeout_seconds: 60,
  on_success: { behavior: "continue" },
  on_failure: "stop",
  retry_policy: {
    enabled: true,
    max_attempts: 3,
    delay_seconds: 5,
    backoff_multiplier: 2.0,
    max_delay_seconds: 30
  },
  connector_id: "firewall-01",
  action_type: "block_ip",
  input: {
    ip_address: "trigger_data.data.source_ip",
    duration: "literal:24h",
    reason: "trigger_data.rule.name"
  },
  requires_approval: false  // If true, approval must precede this step
};

// ═══════════════════════════════════════════════════════════════════════════════
// STEP TYPE: NOTIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Notification Step Schema
 *
 * Sends notifications to channels/users.
 *
 * @typedef {Object} NotificationStep
 * @property {string} connector_id - Notification connector (slack, email, teams)
 * @property {string} channel - Target channel/recipient
 * @property {string} template - Message template with variable placeholders
 * @property {string} severity - Notification priority (info, warning, critical)
 */

export const NotificationStepExample = {
  step_id: "notify_soc",
  name: "Notify SOC Team",
  type: "notification",
  timeout_seconds: 30,
  on_success: { behavior: "continue" },
  on_failure: "continue",  // Notification failure shouldn't stop execution
  connector_id: "slack",
  action_type: "send_message",
  input: {
    channel: "literal:#soc-alerts",
    message_template: "literal:🚨 Alert {{trigger_data.rule.name}} - IP {{trigger_data.data.source_ip}} blocked with abuse score {{steps.enrich_source_ip.output.abuse_score}}",
    severity: "trigger_data.severity"
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMPLETE PLAYBOOK DSL EXAMPLE
// ═══════════════════════════════════════════════════════════════════════════════

export const CompletePlaybookExample = {
  playbook_id: "PB-BRUTE-FORCE-001",
  name: "SSH Brute Force Response",
  description: "Automated response to SSH brute force attacks",
  version: 1,
  status: "active",
  shadow_mode: false,  // When true, actions are SKIPPED
  trigger_type: "webhook",

  // Webhook configuration (auto-generated)
  webhook: {
    secret: "auto-generated-32-byte-hex",
    enabled: true
  },

  // Expected trigger schema (for validation)
  expected_schema: {
    required: ["rule.id", "severity", "data.source_ip"],
    severity_values: ["high", "critical"]
  },

  // Step definitions
  steps: [
    {
      step_id: "enrich_source_ip",
      name: "Enrich Source IP",
      type: "enrichment",
      timeout_seconds: 30,
      on_success: { behavior: "continue" },
      on_failure: "continue",
      retry_policy: { enabled: true, max_attempts: 3, delay_seconds: 2 },
      connector_id: "abuseipdb",
      action_type: "lookup_ip",
      input: {
        ip_address: "trigger_data.data.source_ip"
      }
    },
    {
      step_id: "check_abuse_score",
      name: "Check Abuse Score",
      type: "condition",
      timeout_seconds: 5,
      on_success: { behavior: "continue" },
      on_failure: "stop",
      condition: {
        field: "steps.enrich_source_ip.output.abuse_score",
        operator: "greater_than",
        value: 80
      },
      on_true: "approve_block",
      on_false: "notify_low_score"
    },
    {
      step_id: "approve_block",
      name: "Approve IP Block",
      type: "approval",
      timeout_seconds: 3600,
      on_success: { behavior: "continue" },
      on_failure: "stop",
      approvers: ["role:soc_analyst"],
      message: "Approve blocking {{trigger_data.data.source_ip}}?",
      input: {
        source_ip: "trigger_data.data.source_ip",
        abuse_score: "steps.enrich_source_ip.output.abuse_score"
      },
      timeout_hours: 1,
      on_approved: "block_ip",
      on_rejected: "notify_rejected",
      on_timeout: "notify_timeout"
    },
    {
      step_id: "block_ip",
      name: "Block IP on Firewall",
      type: "action",
      timeout_seconds: 60,
      on_success: { behavior: "continue" },
      on_failure: "stop",
      retry_policy: { enabled: true, max_attempts: 3, delay_seconds: 5 },
      connector_id: "firewall-01",
      action_type: "block_ip",
      input: {
        ip_address: "trigger_data.data.source_ip",
        duration: "literal:24h"
      }
    },
    {
      step_id: "notify_success",
      name: "Notify Success",
      type: "notification",
      timeout_seconds: 30,
      on_success: { behavior: "end" },
      on_failure: "continue",
      connector_id: "slack",
      action_type: "send_message",
      input: {
        channel: "literal:#soc-alerts",
        message_template: "literal:✅ Blocked {{trigger_data.data.source_ip}} successfully"
      }
    },
    {
      step_id: "notify_low_score",
      name: "Notify Low Score (No Action)",
      type: "notification",
      timeout_seconds: 30,
      on_success: { behavior: "end" },
      on_failure: "continue",
      connector_id: "slack",
      action_type: "send_message",
      input: {
        channel: "literal:#soc-alerts",
        message_template: "literal:ℹ️ IP {{trigger_data.data.source_ip}} has low abuse score, no action taken"
      }
    },
    {
      step_id: "notify_rejected",
      name: "Notify Rejection",
      type: "notification",
      timeout_seconds: 30,
      on_success: { behavior: "end" },
      on_failure: "continue",
      connector_id: "slack",
      action_type: "send_message",
      input: {
        channel: "literal:#soc-alerts",
        message_template: "literal:❌ Block for {{trigger_data.data.source_ip}} was rejected"
      }
    },
    {
      step_id: "notify_timeout",
      name: "Notify Timeout",
      type: "notification",
      timeout_seconds: 30,
      on_success: { behavior: "end" },
      on_failure: "continue",
      connector_id: "slack",
      action_type: "send_message",
      input: {
        channel: "literal:#soc-alerts",
        message_template: "literal:⏰ Approval timed out for {{trigger_data.data.source_ip}}"
      }
    }
  ],

  // Metadata
  created_by: "admin@cybersentinel.local",
  created_at: "2026-01-17T00:00:00Z"
};

export default {
  // Hardening constants
  STEP_END,
  MAX_STEP_EXECUTIONS,
  VALID_APPROVAL_TIMEOUT_BEHAVIORS,

  // Canonical types
  StepType,
  StepState,
  ExecutionState,
  OnFailureBehavior,
  OnSuccessBehavior,
  ConditionOperators,
  InputMappingPrefix,

  // Schemas
  BaseStepSchema,
  RetryPolicySchema,

  // Examples
  EnrichmentStepExample,
  ConditionStepExample,
  ApprovalStepExample,
  ActionStepExample,
  NotificationStepExample,
  CompletePlaybookExample
};
