import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type AlertRow = Database['public']['Tables']['alerts']['Row'];
type AlertInsert = Database['public']['Tables']['alerts']['Insert'];
type AlertUpdate = Database['public']['Tables']['alerts']['Update'];

export interface Alert {
  id: string;
  alertId: string;
  timestamp: string;
  ruleId: string;
  ruleName: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  agentId: string | null;
  agentName: string | null;
  mitreTechnique: string | null;
  mitreTactic: string | null;
  description: string | null;
  sourceIp: string | null;
  destinationIp: string | null;
  status: 'new' | 'acknowledged' | 'in_progress' | 'resolved';
  rawData: Record<string, unknown>;
}

const mapAlertFromDb = (row: AlertRow): Alert => ({
  id: row.id,
  alertId: row.alert_id,
  timestamp: row.timestamp,
  ruleId: row.rule_id,
  ruleName: row.rule_name,
  severity: row.severity as Alert['severity'],
  agentId: row.agent_id,
  agentName: row.agent_name,
  mitreTechnique: row.mitre_technique,
  mitreTactic: row.mitre_tactic,
  description: row.description,
  sourceIp: row.source_ip,
  destinationIp: row.destination_ip,
  status: row.status as Alert['status'],
  rawData: (row.raw_data as Record<string, unknown>) || {},
});

export const useAlerts = () => {
  return useQuery({
    queryKey: ['alerts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('alerts')
        .select('*')
        .order('timestamp', { ascending: false });
      
      if (error) throw error;
      return (data || []).map(mapAlertFromDb);
    },
  });
};

export const useUpdateAlertStatus = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Alert['status'] }) => {
      const { error } = await supabase
        .from('alerts')
        .update({ status })
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
};

export const useCreateAlert = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (alert: Omit<AlertInsert, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('alerts')
        .insert(alert)
        .select()
        .single();
      
      if (error) throw error;
      return mapAlertFromDb(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
};
