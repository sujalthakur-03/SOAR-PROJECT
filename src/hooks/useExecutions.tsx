import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

/**
 * Execution Filters for querying executions
 * Aligns with the execution-centric architecture where Execution = Alert + Response
 */
export interface ExecutionFilters {
  state?: 'EXECUTING' | 'WAITING_APPROVAL' | 'COMPLETED' | 'FAILED';
  playbook_id?: string;
  severity?: string; // Filters trigger_data.severity (nested field)
  rule_id?: string;  // Filters trigger_data.rule_id (nested field)
  from_time?: string; // ISO 8601 timestamp
  to_time?: string;   // ISO 8601 timestamp
  limit?: number;
  offset?: number;
  sort_by?: 'execution_id' | 'event_time' | 'started_at';
  sort_order?: 'asc' | 'desc';
}

/**
 * Execution entity representing Alert + Response
 */
export interface Execution {
  id: string;
  execution_id: string;
  executionId: string; // Alias for frontend compatibility
  playbook_id: string;
  playbook_name?: string;
  playbookName?: string; // Alias for frontend compatibility
  state: 'CREATED' | 'ENRICHING' | 'WAITING_APPROVAL' | 'EXECUTING' | 'COMPLETED' | 'FAILED';
  trigger_data?: any;
  started_at?: string;
  startedAt?: string; // Alias for frontend compatibility
  completed_at?: string;
  duration_ms?: number;
  error?: string;
  sla_status?: any;
}

/**
 * Hook to query executions with filtering and pagination
 * This is the PRIMARY data source for SOC operators
 */
export const useExecutions = (filters?: ExecutionFilters, enableLivePolling: boolean = true) => {
  return useQuery({
    queryKey: ['executions', filters],
    queryFn: () => apiClient.getExecutions(filters),
    select: (response) => ({
      executions: (response.data || []).map((exec: any) => ({
        ...exec,
        executionId: exec.execution_id || exec.executionId,
        playbookName: exec.playbook_name || exec.playbookName,
        startedAt: exec.started_at || exec.startedAt,
      })),
      total: response.total || 0,
      page: response.page || 1,
      pageSize: response.page_size || response.pageSize || 50
    }),
    refetchInterval: enableLivePolling ? 3000 : false // Live polling every 3 seconds
  });
};

/**
 * Hook to fetch a single execution by execution_id
 * Used for detail views showing full trigger_data and step timeline
 */
export const useExecution = (execution_id: string, enabled: boolean = true) => {
  return useQuery({
    queryKey: ['executions', execution_id],
    queryFn: () => apiClient.getExecution(execution_id),
    enabled: !!execution_id && enabled
  });
};

/**
 * Hook to query executions by state (for dashboard summary cards)
 */
export const useExecutionsByState = (state: ExecutionFilters['state'], limit: number = 50) => {
  return useExecutions({ state, limit, sort_by: 'event_time', sort_order: 'desc' });
};

/**
 * Hook to get execution statistics (counts by state)
 * Used for dashboard summary cards
 */
export const useExecutionStats = () => {
  return useQuery({
    queryKey: ['execution-stats'],
    queryFn: () => apiClient.getExecutionStats(),
    refetchInterval: 10000 // Refresh every 10 seconds for live monitoring
  });
};

/**
 * Hook to create a new execution (manual trigger / simulation)
 */
export const useCreateExecution = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      playbook_id: string;
      trigger_data: any;
      trigger_source?: 'webhook' | 'manual' | 'simulation';
    }) => apiClient.createExecution(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['executions'] });
      queryClient.invalidateQueries({ queryKey: ['execution-stats'] });
    },
  });
};

/**
 * Hook to re-execute a playbook with the same trigger_data (bypass trigger conditions)
 * Used when an analyst wants to retry a failed or timed-out execution
 */
export const useReExecute = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { playbook_id: string; trigger_data: any }) =>
      apiClient.reExecute(data.playbook_id, data.trigger_data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['executions'] });
      queryClient.invalidateQueries({ queryKey: ['execution-stats'] });
    },
  });
};
