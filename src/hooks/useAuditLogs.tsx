import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export const useAuditLogs = () => {
  return useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => apiClient.getAuditLogs({ limit: 100 }),
  });
};
