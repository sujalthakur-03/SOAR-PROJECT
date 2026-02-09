import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface TimelineEvent {
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
}

export interface ExecutionTimelineData {
  execution_id: string;
  playbook_id: string;
  playbook_name: string;
  state: string;
  sla_policy_id?: string;
  sla_status?: {
    acknowledge?: {
      threshold_ms: number;
      actual_ms?: number;
      breached: boolean;
    };
    containment?: {
      threshold_ms: number;
      actual_ms?: number;
      breached: boolean;
    };
    resolution?: {
      threshold_ms: number;
      actual_ms?: number;
      breached: boolean;
    };
  };
  timeline: TimelineEvent[];
}

export const useExecutionTimeline = (executionId: string, enabled: boolean = true) => {
  return useQuery({
    queryKey: ['execution-timeline', executionId],
    queryFn: () => apiClient.getExecutionTimeline(executionId),
    enabled: !!executionId && enabled,
    refetchInterval: (data) => {
      // Refetch every 5 seconds if execution is still running
      if (data?.state && ['EXECUTING', 'ENRICHING', 'WAITING_APPROVAL'].includes(data.state)) {
        return 5000;
      }
      return false;
    },
  });
};
