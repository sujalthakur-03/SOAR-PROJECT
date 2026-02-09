/**
 * API Client for CyberSentinel Backend
 * Centralized HTTP client for backend API calls
 *
 * NOTE: Without nginx proxy, we connect directly to the backend on port 3001
 * The backend URL is dynamically constructed from the browser's hostname
 */

/**
 * Get the backend base URL dynamically based on current hostname
 * This ensures the frontend works regardless of how it's accessed (localhost, IP, domain)
 */
export const getBackendBaseUrl = (): string => {
  if (typeof window !== 'undefined') {
    // In browser: use same hostname as frontend, but backend port 3001
    return `http://${window.location.hostname}:3001`;
  }
  // Fallback for SSR/testing
  return 'http://localhost:3001';
};

const API_BASE_URL = '/api';

// ═══════════════════════════════════════════════════════════════════════════════
// PAYLOAD UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a client-side playbook_id for new playbooks.
 * Format: PB-AUTO-{6 hex chars} — matches backend pattern /^PB-[A-Z0-9_-]+$/i
 * Backend duplicate-checks this ID before saving (playbook-service-v2.js:183).
 */
function generatePlaybookId(): string {
  const chars = '0123456789ABCDEF';
  let hex = '';
  for (let i = 0; i < 6; i++) {
    hex += chars[Math.floor(Math.random() * 16)];
  }
  return `PB-AUTO-${hex}`;
}

/**
 * Map notification channel to backend-required action_type.
 * Connector-type steps (enrichment, action, notification) all require action_type.
 * For notification steps, action_type is derived from the channel — never exposed in UI.
 */
const NOTIFICATION_CHANNEL_TO_ACTION_TYPE: Record<string, string> = {
  email: 'email',
  slack: 'slack',
  webhook: 'webhook',
  teams: 'teams',
  pagerduty: 'pagerduty',
};

/**
 * Ensure all connector-type steps have action_type before sending to backend.
 * This is a safety net — convertNodesToDSL should already set it.
 */
function ensureStepActionTypes(steps: any[]): any[] {
  return steps.map(step => {
    if (step.type === 'notification' && !step.action_type) {
      return {
        ...step,
        action_type: NOTIFICATION_CHANNEL_TO_ACTION_TYPE[step.channel] || step.channel || 'email',
      };
    }
    return step;
  });
}

/**
 * Map backend validation error codes to SOC-analyst-friendly messages.
 * Prevents exposing internal field names like action_type or playbook_id.
 */
const VALIDATION_ERROR_REWRITES: Record<string, (e: any) => string> = {
  CONNECTOR_MISSING_ACTION_TYPE: (e) => {
    const stepName = e.step_id ? `Step "${e.step_id}"` : 'A step';
    const stepType = e.step_type || 'connector';
    if (stepType === 'notification') {
      return `${stepName}: Notification channel is not configured. Select a channel (Email, Slack, Webhook) in the step settings.`;
    }
    return `${stepName}: Action type is missing. Select an action in the step settings.`;
  },
  CONNECTOR_MISSING_CONNECTOR_ID: (e) => {
    const stepName = e.step_id ? `Step "${e.step_id}"` : 'A step';
    return `${stepName}: No connector selected. Choose a connector in the step settings.`;
  },
};

/**
 * Rewrite raw backend/Mongoose error messages into SOC-analyst-friendly text.
 * Catches Mongoose validation errors and internal field names.
 */
function rewriteErrorMessage(raw: string): string {
  if (raw.includes('playbook_id is required') || raw.includes('PlaybookVersioned validation failed')) {
    return 'Internal versioning error. The playbook could not be saved — it was incorrectly treated as an update. Please try again or report this issue.';
  }
  if (raw.includes('DUPLICATE_PLAYBOOK_ID') || raw.includes('already exists')) {
    return 'A playbook with this ID already exists. Please try creating again.';
  }
  return raw;
}

class APIClient {
  private getFullUrl(endpoint: string): string {
    return `${getBackendBaseUrl()}${API_BASE_URL}${endpoint}`;
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const url = this.getFullUrl(endpoint);

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));

      // Enhanced error handling for validation errors
      if (response.status === 400 && error.code === 'DSL_VALIDATION_ERROR') {
        const details = error.details || {};
        const errors = details.errors || [];

        if (errors.length > 0) {
          const errorMessages = errors.map((e: any) => {
            // Use friendly rewrite if available, otherwise fall back to raw message
            const rewrite = VALIDATION_ERROR_REWRITES[e.code];
            if (rewrite) return rewrite(e);
            return `${e.step_id ? `Step "${e.step_id}": ` : ''}${e.message}`;
          }).join('\n');
          throw new Error(`Playbook validation failed:\n${errorMessages}`);
        }
      }

      const rawMessage = error.message || `HTTP ${response.status}: ${response.statusText}`;
      throw new Error(rewriteErrorMessage(rawMessage));
    }

    return response.json();
  }

  // ============================================================================
  // NOTE: Alerts are NOT a separate entity in this architecture.
  // In CyberSentinel SOAR v3.x: Execution = Alert + Response
  // All alert data is accessed via executions (trigger_data contains alert details)
  // ============================================================================

  // ============================================================================
  // PLAYBOOKS (using v2 API with versioning support)
  // ============================================================================

  async getPlaybooks() {
    // v2 API defaults to enabled=true when no filter is passed,
    // which hides disabled playbooks from the list.
    // Pass all_versions=true to bypass the enabled filter, then
    // deduplicate in the frontend (usePlaybooks hook) to keep
    // only the latest version per playbook_id.
    const result = await this.request<{ playbooks: any[]; total: number }>(
      '/v2/playbooks?all_versions=true'
    );
    return result.playbooks || [];
  }

  async getPlaybook(id: string) {
    return this.request<any>(`/v2/playbooks/${id}`);
  }

  async createPlaybook(playbook: any) {
    // ═══════════════════════════════════════════════════════════════════════
    // CREATE payload: POST /api/v2/playbooks
    // Required: playbook_id, name, dsl (with trigger + steps)
    // Must NOT contain: version, change_summary, enabled
    // ═══════════════════════════════════════════════════════════════════════

    // CLIENT-SIDE VALIDATION: Backend requires at least one step
    if (!playbook.steps || playbook.steps.length === 0) {
      throw new Error('Playbook must contain at least one step. Add steps to the canvas before saving.');
    }

    if (!playbook.name || playbook.name.trim() === '') {
      throw new Error('Playbook name is required');
    }

    // Build strict CREATE payload — no version metadata
    const createPayload = {
      playbook_id: generatePlaybookId(),
      name: playbook.name.trim(),
      description: playbook.description || '',
      dsl: {
        trigger: playbook.trigger || {},
        steps: ensureStepActionTypes(playbook.steps || []),
      },
      // Explicitly excluded: version, change_summary, enabled
    };

    return this.request<any>('/v2/playbooks', {
      method: 'POST',
      body: JSON.stringify(createPayload),
    });
  }

  async updatePlaybook(id: string, playbook: any) {
    // ═══════════════════════════════════════════════════════════════════════
    // UPDATE payload: PUT /api/v2/playbooks/:playbook_id
    // playbook_id is in the URL path — NOT in the body
    // Must NOT contain: playbook_id, version, enabled
    // ═══════════════════════════════════════════════════════════════════════

    if (!id) {
      throw new Error('Internal versioning error. The playbook could not be saved — it was incorrectly treated as an update. Please try again or report this issue.');
    }

    // CLIENT-SIDE VALIDATION: Backend requires at least one step
    if (!playbook.steps || playbook.steps.length === 0) {
      throw new Error('Playbook must contain at least one step. Add steps to the canvas before saving.');
    }

    if (!playbook.name || playbook.name.trim() === '') {
      throw new Error('Playbook name is required');
    }

    // Build strict UPDATE payload — playbook_id is in URL, not body
    const updatePayload = {
      name: playbook.name.trim(),
      description: playbook.description || '',
      dsl: {
        trigger: playbook.trigger || {},
        steps: ensureStepActionTypes(playbook.steps || []),
      },
      change_summary: playbook.change_summary || 'Updated via playbook editor',
      // Explicitly excluded: playbook_id (in URL), version, enabled
    };

    return this.request<any>(`/v2/playbooks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updatePayload),
    });
  }

  async togglePlaybook(id: string, enabled: boolean, version?: number) {
    // Pass version when re-enabling a disabled playbook — the backend
    // needs it because no "active" version exists to look up.
    const versionParam = version ? `?version=${version}` : '';
    return this.request<any>(`/v2/playbooks/${id}/toggle${versionParam}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  }

  async deletePlaybook(id: string) {
    return this.request<any>(`/v2/playbooks/${id}`, {
      method: 'DELETE',
    });
  }

  // ============================================================================
  // EXECUTIONS (PRIMARY ENTITY - Execution = Alert + Response)
  // ============================================================================

  async getExecutions(params?: {
    state?: 'EXECUTING' | 'WAITING_APPROVAL' | 'COMPLETED' | 'FAILED';
    playbook_id?: string;
    severity?: string; // Filters trigger_data.severity
    rule_id?: string;  // Filters trigger_data.rule_id
    from_time?: string;
    to_time?: string;
    limit?: number;
    offset?: number;
    sort_by?: 'execution_id' | 'event_time' | 'started_at';
    sort_order?: 'asc' | 'desc';
  }) {
    const searchParams = new URLSearchParams();
    if (params?.state) searchParams.append('state', params.state);
    if (params?.playbook_id) searchParams.append('playbook_id', params.playbook_id);
    if (params?.severity) searchParams.append('severity', params.severity);
    if (params?.rule_id) searchParams.append('rule_id', params.rule_id);
    if (params?.from_time) searchParams.append('from_time', params.from_time);
    if (params?.to_time) searchParams.append('to_time', params.to_time);
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.offset) searchParams.append('offset', params.offset.toString());
    if (params?.sort_by) searchParams.append('sort_by', params.sort_by);
    if (params?.sort_order) searchParams.append('sort_order', params.sort_order);

    const query = searchParams.toString();
    return this.request<{
      data: any[];
      total: number;
      page: number;
      page_size: number;
    }>(`/executions${query ? `?${query}` : ''}`);
  }

  async getExecution(execution_id: string) {
    return this.request<any>(`/executions/${execution_id}`);
  }

  async createExecution(data: {
    playbook_id: string;
    trigger_data: any;
    trigger_source?: 'webhook' | 'manual' | 'simulation';
  }) {
    return this.request<any>('/executions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getExecutionStats() {
    return this.request<{
      executing: number;
      waiting_approval: number;
      completed: number;
      failed: number;
      total: number;
    }>(`/executions/stats`);
  }

  async reExecute(playbook_id: string, trigger_data: any) {
    return this.request<any>('/executions/trigger', {
      method: 'POST',
      body: JSON.stringify({ playbook_id, trigger_data, bypass_trigger: true }),
    });
  }

  // ============================================================================
  // APPROVALS
  // ============================================================================

  async getApprovals(params?: { status?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.append('status', params.status);

    const query = searchParams.toString();
    return this.request<any[]>(`/approvals${query ? `?${query}` : ''}`);
  }

  async approveAction(id: string, reason?: string) {
    return this.request<any>(`/approvals/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async rejectAction(id: string, reason?: string) {
    return this.request<any>(`/approvals/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  // ============================================================================
  // CONNECTORS
  // ============================================================================

  async getConnectors() {
    return this.request<any[]>('/connectors');
  }

  async getConnector(id: string) {
    return this.request<any>(`/connectors/${id}`);
  }

  async createConnector(data: any) {
    return this.request<any>('/connectors', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateConnector(id: string, data: any) {
    return this.request<any>(`/connectors/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteConnector(id: string) {
    return this.request<any>(`/connectors/${id}`, {
      method: 'DELETE',
    });
  }

  async testConnector(id: string, testData?: {
    action?: string;
    parameters?: Record<string, unknown>;
  }) {
    return this.request<any>(`/connectors/${id}/test`, {
      method: 'POST',
      body: testData ? JSON.stringify(testData) : undefined,
    });
  }

  // ============================================================================
  // AUDIT LOGS
  // ============================================================================

  async getAuditLogs(params?: { limit?: number }) {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.append('limit', params.limit.toString());

    const query = searchParams.toString();
    return this.request<any[]>(`/audit${query ? `?${query}` : ''}`);
  }

  // ============================================================================
  // SOC METRICS - Execution-based KPIs and SLA tracking
  // ============================================================================

  async getSOCKPIs() {
    return this.request<{
      total_executions: number;
      active_executions: number;
      pending_approvals: number;
      failed_executions: number;
      automation_rate: number;
      avg_execution_time_seconds: number;
    }>('/soc/kpis');
  }

  async getMTTA(params?: { from_time?: string; to_time?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.from_time) searchParams.append('from_time', params.from_time);
    if (params?.to_time) searchParams.append('to_time', params.to_time);

    const query = searchParams.toString();
    return this.request<{
      mtta_seconds: number;
      mtta_formatted: string;
      sample_size: number;
      period: { from: string; to: string };
    }>(`/soc/metrics/mtta${query ? `?${query}` : ''}`);
  }

  async getMTTR(params?: { from_time?: string; to_time?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.from_time) searchParams.append('from_time', params.from_time);
    if (params?.to_time) searchParams.append('to_time', params.to_time);

    const query = searchParams.toString();
    return this.request<{
      mttr_seconds: number;
      mttr_formatted: string;
      sample_size: number;
      period: { from: string; to: string };
    }>(`/soc/metrics/mttr${query ? `?${query}` : ''}`);
  }

  async getSLAStatus() {
    return this.request<{
      compliance_rate: number;
      total_executions: number;
      within_sla: number;
      breached_sla: number;
      by_severity: {
        critical: { total: number; within_sla: number; breached: number; compliance_rate: number };
        high: { total: number; within_sla: number; breached: number; compliance_rate: number };
        medium: { total: number; within_sla: number; breached: number; compliance_rate: number };
        low: { total: number; within_sla: number; breached: number; compliance_rate: number };
      };
    }>('/soc/sla/status');
  }

  // ============================================================================
  // WEBHOOKS & TRIGGERS
  // ============================================================================

  async createPlaybookWebhook(playbookId: string, trigger?: {
    conditions?: Array<{ field: string; operator: string; value: string }>;
    match?: string;
  }) {
    return this.request<any>(`/playbooks/${playbookId}/webhook`, {
      method: 'POST',
      body: JSON.stringify(trigger || {}),
    });
  }

  async getPlaybookWebhook(playbookId: string) {
    return this.request<any>(`/playbooks/${playbookId}/webhook`);
  }

  async createOrUpdateTrigger(playbookId: string, triggerDef: {
    conditions: Array<{ field: string; operator: string; value: string }>;
    match?: string;
    name?: string;
  }) {
    return this.request<any>(`/playbooks/${playbookId}/trigger`, {
      method: 'POST',
      body: JSON.stringify(triggerDef),
    });
  }

  async toggleConnector(id: string, enabled: boolean) {
    return this.request<any>(`/connectors/${id}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  }

  // ============================================================================
  // SOC METRICS & TIMELINE - Execution-based KPIs and drill-down
  // ============================================================================

  async getExecutionTimeline(executionId: string) {
    return this.request<{
      execution_id: string;
      playbook_id: string;
      playbook_name: string;
      state: string;
      sla_policy_id?: string;
      sla_status?: any;
      timeline: Array<{
        timestamp: string;
        event: string;
        description: string;
        duration_ms?: number;
        step_id?: string;
        step_index?: number;
        state?: string;
        error?: string;
        sla_check?: {
          dimension: string;
          threshold_ms?: number;
          breached?: boolean;
        };
      }>;
    }>(`/soc/executions/${executionId}/timeline`);
  }

  // ============================================================================
  // CASE MANAGEMENT - SOC-grade case tracking and lifecycle management
  // ============================================================================

  async getCases(params?: {
    status?: string | string[];
    severity?: string | string[];
    assigned_to?: string;
    created_by?: string;
    tags?: string | string[];
    sla_breached?: boolean;
    from_date?: string;
    to_date?: string;
    limit?: number;
    offset?: number;
    sort_by?: 'case_id' | 'created_at' | 'severity' | 'status';
    sort_order?: 'asc' | 'desc';
  }) {
    const searchParams = new URLSearchParams();
    if (params?.status) {
      const statusStr = Array.isArray(params.status) ? params.status.join(',') : params.status;
      searchParams.append('status', statusStr);
    }
    if (params?.severity) {
      const sevStr = Array.isArray(params.severity) ? params.severity.join(',') : params.severity;
      searchParams.append('severity', sevStr);
    }
    if (params?.assigned_to) searchParams.append('assigned_to', params.assigned_to);
    if (params?.created_by) searchParams.append('created_by', params.created_by);
    if (params?.tags) {
      const tagsStr = Array.isArray(params.tags) ? params.tags.join(',') : params.tags;
      searchParams.append('tags', tagsStr);
    }
    if (params?.sla_breached !== undefined) searchParams.append('sla_breached', params.sla_breached.toString());
    if (params?.from_date) searchParams.append('from_date', params.from_date);
    if (params?.to_date) searchParams.append('to_date', params.to_date);
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.offset) searchParams.append('offset', params.offset.toString());
    if (params?.sort_by) searchParams.append('sort_by', params.sort_by);
    if (params?.sort_order) searchParams.append('sort_order', params.sort_order);

    const query = searchParams.toString();
    return this.request<{
      data: any[];
      total: number;
      page: number;
      page_size: number;
      total_pages: number;
    }>(`/cases${query ? `?${query}` : ''}`);
  }

  async getCase(caseId: string) {
    return this.request<any>(`/cases/${caseId}`);
  }

  async getCaseStats(params?: { from_date?: string; to_date?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.from_date) searchParams.append('from_date', params.from_date);
    if (params?.to_date) searchParams.append('to_date', params.to_date);

    const query = searchParams.toString();
    return this.request<{
      total_cases: number;
      open: number;
      investigating: number;
      pending: number;
      resolved: number;
      closed: number;
      severity: {
        critical: number;
        high: number;
        medium: number;
        low: number;
      };
      sla_breached: number;
      avg_resolution_time_ms: number;
      avg_resolution_time_hours: number;
    }>(`/cases/stats${query ? `?${query}` : ''}`);
  }

  async createCaseFromExecution(executionId: string, data: {
    title?: string;
    description?: string;
    severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    priority?: 'P1' | 'P2' | 'P3' | 'P4';
    assigned_to?: string;
    tags?: string[];
  }) {
    return this.request<any>(`/cases/from-execution/${executionId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateCase(caseId: string, data: {
    title?: string;
    description?: string;
    severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    priority?: 'P1' | 'P2' | 'P3' | 'P4';
    tags?: string[];
    resolution_summary?: string;
  }) {
    return this.request<any>(`/cases/${caseId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async transitionCaseStatus(caseId: string, status: 'OPEN' | 'INVESTIGATING' | 'PENDING' | 'RESOLVED' | 'CLOSED', reason?: string) {
    return this.request<any>(`/cases/${caseId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason }),
    });
  }

  async assignCase(caseId: string, assignedTo: string) {
    return this.request<any>(`/cases/${caseId}/assign`, {
      method: 'PATCH',
      body: JSON.stringify({ assigned_to: assignedTo }),
    });
  }

  async linkExecutionToCase(caseId: string, executionId: string) {
    return this.request<any>(`/cases/${caseId}/link-execution/${executionId}`, {
      method: 'POST',
    });
  }

  async unlinkExecutionFromCase(caseId: string, executionId: string) {
    return this.request<any>(`/cases/${caseId}/unlink-execution/${executionId}`, {
      method: 'DELETE',
    });
  }

  async addCaseEvidence(caseId: string, evidence: {
    type: 'file' | 'url' | 'hash' | 'note' | 'screenshot' | 'log' | 'other';
    name: string;
    description?: string;
    content?: any;
    metadata?: any;
  }) {
    return this.request<any>(`/cases/${caseId}/evidence`, {
      method: 'POST',
      body: JSON.stringify(evidence),
    });
  }

  async addCaseComment(caseId: string, comment: {
    content: string;
    comment_type?: 'note' | 'update' | 'analysis' | 'resolution' | 'internal' | 'external';
    visibility?: 'internal' | 'external' | 'restricted';
    metadata?: any;
  }) {
    return this.request<any>(`/cases/${caseId}/comments`, {
      method: 'POST',
      body: JSON.stringify(comment),
    });
  }

  async getCaseComments(caseId: string) {
    return this.request<any[]>(`/cases/${caseId}/comments`);
  }

  async getCaseTimeline(caseId: string) {
    return this.request<any[]>(`/cases/${caseId}/timeline`);
  }

  async getAssignedCases(analyst: string, status?: string) {
    const searchParams = new URLSearchParams();
    if (status) searchParams.append('status', status);
    const query = searchParams.toString();
    return this.request<any[]>(`/cases/assigned/${analyst}${query ? `?${query}` : ''}`);
  }
}

export const apiClient = new APIClient();
