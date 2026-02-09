import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export const useApprovals = () => {
  return useQuery({
    queryKey: ['approvals'],
    queryFn: () => apiClient.getApprovals(),
  });
};

export const useApproveAction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => {
      return apiClient.approveAction(id, reason);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['executions'] });
    },
  });
};

export const useRejectAction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => {
      return apiClient.rejectAction(id, reason);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['executions'] });
    },
  });
};
