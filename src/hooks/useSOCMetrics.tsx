import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

/**
 * Hook for fetching SOC KPIs (execution-based metrics)
 * Returns: total_executions, active_executions, pending_approvals, failed_executions,
 *          automation_rate, avg_execution_time_seconds
 */
export const useSOCKPIs = () => {
  return useQuery({
    queryKey: ['soc', 'kpis'],
    queryFn: () => apiClient.getSOCKPIs(),
    refetchInterval: 30000, // Refresh every 30 seconds
  });
};

/**
 * Hook for fetching Mean Time to Acknowledge (MTTA)
 * Measures time from alert trigger to playbook execution start
 */
export const useMTTA = (params?: { from_time?: string; to_time?: string }) => {
  return useQuery({
    queryKey: ['soc', 'metrics', 'mtta', params],
    queryFn: () => apiClient.getMTTA(params),
    refetchInterval: 60000, // Refresh every minute
  });
};

/**
 * Hook for fetching Mean Time to Respond (MTTR)
 * Measures time from alert trigger to playbook execution completion
 */
export const useMTTR = (params?: { from_time?: string; to_time?: string }) => {
  return useQuery({
    queryKey: ['soc', 'metrics', 'mttr', params],
    queryFn: () => apiClient.getMTTR(params),
    refetchInterval: 60000, // Refresh every minute
  });
};

/**
 * Hook for fetching SLA compliance status
 * Returns compliance metrics broken down by severity level
 */
export const useSLAStatus = () => {
  return useQuery({
    queryKey: ['soc', 'sla', 'status'],
    queryFn: () => apiClient.getSLAStatus(),
    refetchInterval: 60000, // Refresh every minute
  });
};
