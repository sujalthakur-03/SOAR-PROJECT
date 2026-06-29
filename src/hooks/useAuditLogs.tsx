import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface AuditFilters {
  limit?: number;
  offset?: number;
  actor_email?: string;
  action?: string;
  resource_type?: string;
  resource_id?: string;
  outcome?: 'success' | 'failure' | 'partial';
  start_date?: string;
  end_date?: string;
}

export const useAuditLogs = (filters?: AuditFilters) => {
  return useQuery({
    queryKey: ['audit-logs', filters ?? {}],
    queryFn: () => apiClient.getAuditLogs({ limit: 100, ...(filters ?? {}) }),
    // 30s stale time — audit log is append-only; refetch on demand via the
    // Refresh button rather than aggressive polling.
    staleTime: 30_000,
  });
};
