import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface Connector {
  id: string;
  connector_id: string;
  name: string;
  type: string;
  description?: string;
  status: 'active' | 'inactive' | 'error' | 'testing';
  config: Record<string, any>;
  last_health_check?: string;
  health_status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  health_message?: string;
  total_executions: number;
  successful_executions: number;
  failed_executions: number;
  last_executed_at?: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by?: string;
  tags?: string[];
}

export const useConnectors = () => {
  return useQuery({
    queryKey: ['connectors'],
    queryFn: () => apiClient.getConnectors(),
  });
};

export const useConnector = (id: string, enabled: boolean = true) => {
  return useQuery({
    queryKey: ['connectors', id],
    queryFn: () => apiClient.getConnector(id),
    enabled: !!id && enabled,
  });
};

export const useCreateConnector = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: any) => {
      return apiClient.createConnector(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
    },
  });
};

export const useUpdateConnector = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return apiClient.updateConnector(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
    },
  });
};

export const useDeleteConnector = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return apiClient.deleteConnector(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
    },
  });
};

export const useTestConnector = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return apiClient.testConnector(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
    },
  });
};

export const useToggleConnector = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      return apiClient.toggleConnector(id, enabled);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
    },
  });
};
