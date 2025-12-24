import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type ConnectorRow = Database['public']['Tables']['connectors']['Row'];

export interface Connector {
  id: string;
  connectorId: string;
  name: string;
  type: string;
  status: 'healthy' | 'degraded' | 'error' | 'disabled';
  enabled: boolean;
  lastCheck: string | null;
  lastExecution: string | null;
  executionCount: number;
  errorCount: number;
  actions: string[];
}

const mapConnectorFromDb = (row: ConnectorRow): Connector => ({
  id: row.id,
  connectorId: row.connector_id,
  name: row.name,
  type: row.type,
  status: row.status as Connector['status'],
  enabled: row.enabled,
  lastCheck: row.last_check,
  lastExecution: row.last_execution,
  executionCount: row.execution_count,
  errorCount: row.error_count,
  actions: row.actions || [],
});

export const useConnectors = () => {
  return useQuery({
    queryKey: ['connectors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('connectors')
        .select('*')
        .order('name');
      
      if (error) throw error;
      return (data || []).map(mapConnectorFromDb);
    },
  });
};

export const useToggleConnector = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from('connectors')
        .update({ enabled, status: enabled ? 'healthy' : 'disabled' })
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
    },
  });
};
