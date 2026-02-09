// CyberSentinel SOAR Type Definitions
// Maps directly to API contracts

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type ExecutionState = 
  | 'CREATED' 
  | 'ENRICHING' 
  | 'WAITING_APPROVAL' 
  | 'EXECUTING' 
  | 'COMPLETED' 
  | 'FAILED';

export type StepType = 
  | 'enrichment' 
  | 'condition' 
  | 'approval' 
  | 'action' 
  | 'notification';

export type ConnectorStatus = 'healthy' | 'degraded' | 'error' | 'disabled';

// API: GET /api/alerts, WS /ws/alerts
export interface Alert {
  id: string;
  timestamp: string;
  rule_id: string;
  rule_name: string;
  severity: Severity;
  agent_id: string;
  agent_name: string;
  mitre_technique?: string;
  mitre_tactic?: string;
  description: string;
  raw_data: Record<string, unknown>;
  source_ip?: string;
  destination_ip?: string;
  status: 'new' | 'acknowledged' | 'in_progress' | 'resolved';
}

// API: GET/POST/PUT /api/playbooks
// SOAR v3 Option A: Triggers own playbook_id (not the other way around)
// Many playbooks have trigger = null (webhook-only, manual, scheduled)
export interface Playbook {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  trigger?: PlaybookTrigger | null; // Optional: Triggers own playbooks
  steps: PlaybookStep[];
  execution_count: number;
  last_execution?: string;
}

export interface PlaybookTrigger {
  source: 'cybersentinel' | 'webhook' | string;
  rule_ids: string[];
  severity_threshold: Severity;
  conditions?: TriggerCondition[];
}

export interface TriggerCondition {
  field: string;
  operator: 'equals' | 'contains' | 'regex' | 'gt' | 'lt';
  value: string;
}

export interface PlaybookStep {
  id: string;
  order: number;
  type: StepType;
  name: string;
  config: StepConfig;
  timeout_seconds?: number;
  on_failure: 'stop' | 'continue' | 'skip';
}

export type StepConfig = 
  | EnrichmentConfig 
  | ConditionConfig 
  | ApprovalConfig 
  | ActionConfig 
  | NotificationConfig;

export interface EnrichmentConfig {
  type: 'enrichment';
  source: 'virustotal' | 'abuseipdb' | 'shodan' | 'internal_asset_db';
  field: string;
  output_variable: string;
}

export interface ConditionConfig {
  type: 'condition';
  expression: string; // e.g., "enrichment.reputation_score < 50"
  on_true: string; // step ID to jump to
  on_false: string;
}

export interface ApprovalConfig {
  type: 'approval';
  required_role: 'analyst' | 'senior_analyst' | 'admin';
  timeout_hours: number;
  auto_action_on_timeout: 'approve' | 'reject' | 'escalate';
}

export interface ActionConfig {
  type: 'action';
  connector_id: string;
  action_type: string;
  parameters: Record<string, string>;
}

export interface NotificationConfig {
  type: 'notification';
  channel: 'email' | 'slack' | 'webhook' | 'sms';
  recipients: string[];
  template: string;
}

// API: GET /api/executions, WS /ws/executions
export interface Execution {
  id: string;
  playbook_id: string;
  playbook_name: string;
  alert_id: string;
  state: ExecutionState;
  started_at: string;
  completed_at?: string;
  current_step?: number;
  steps: ExecutionStep[];
  error?: string;
}

export interface ExecutionStep {
  step_id: string;
  step_name: string;
  type: StepType;
  state: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  started_at?: string;
  completed_at?: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
}

// API: GET /api/approvals, POST /api/approvals/{id}/approve|reject
export interface Approval {
  id: string;
  execution_id: string;
  playbook_name: string;
  alert: Alert;
  proposed_action: string;
  action_details: Record<string, unknown>;
  requested_at: string;
  expires_at: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  decided_by?: string;
  decided_at?: string;
  reason?: string;
}

// API: GET /api/connectors
export interface Connector {
  id: string;
  name: string;
  type: string;
  status: ConnectorStatus;
  enabled: boolean;
  last_check: string;
  last_execution?: string;
  execution_count: number;
  error_count: number;
  actions: string[];
}

// API: GET /api/audit
export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  actor_role: string;
  action: string;
  resource_type: 'playbook' | 'execution' | 'approval' | 'connector' | 'settings';
  resource_id: string;
  details: Record<string, unknown>;
  ip_address: string;
  outcome: 'success' | 'failure';
}

// API: GET /api/metrics/soar
export interface SOARMetrics {
  mttr_seconds: number;
  mttr_trend: number; // percentage change
  automated_actions: number;
  manual_actions: number;
  automation_rate: number;
  top_playbooks: {
    id: string;
    name: string;
    execution_count: number;
    success_rate: number;
  }[];
  failed_executions: number;
  pending_approvals: number;
  alerts_processed_24h: number;
  connector_health: {
    healthy: number;
    degraded: number;
    error: number;
  };
}
