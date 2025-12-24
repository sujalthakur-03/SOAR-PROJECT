import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type ExecutionRow = Database['public']['Tables']['executions']['Row'];

export interface Execution {
  id: string;
  executionId: string;
  playbookName: string;
  alertId: string | null;
  state: 'CREATED' | 'ENRICHING' | 'WAITING_APPROVAL' | 'EXECUTING' | 'COMPLETED' | 'FAILED';
  currentStep: number | null;
  steps: Record<string, unknown>[];
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

const mapExecutionFromDb = (row: ExecutionRow): Execution => ({
  id: row.id,
  executionId: row.execution_id,
  playbookName: row.playbook_name,
  alertId: row.alert_id,
  state: row.state as Execution['state'],
  currentStep: row.current_step,
  steps: (row.steps as Record<string, unknown>[]) || [],
  error: row.error,
  startedAt: row.started_at,
  completedAt: row.completed_at,
});

export const useExecutions = () => {
  return useQuery({
    queryKey: ['executions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('executions')
        .select('*')
        .order('started_at', { ascending: false });
      
      if (error) throw error;
      return (data || []).map(mapExecutionFromDb);
    },
  });
};
