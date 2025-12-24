import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type PlaybookRow = Database['public']['Tables']['playbooks']['Row'];

export interface Playbook {
  id: string;
  playbookId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  version: number;
  trigger: Record<string, unknown>;
  steps: Record<string, unknown>[];
  executionCount: number;
  lastExecution: string | null;
  createdAt: string;
  updatedAt: string;
}

const mapPlaybookFromDb = (row: PlaybookRow): Playbook => ({
  id: row.id,
  playbookId: row.playbook_id,
  name: row.name,
  description: row.description,
  enabled: row.enabled,
  version: row.version,
  trigger: (row.trigger as Record<string, unknown>) || {},
  steps: (row.steps as Record<string, unknown>[]) || [],
  executionCount: row.execution_count,
  lastExecution: row.last_execution,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const usePlaybooks = () => {
  return useQuery({
    queryKey: ['playbooks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('playbooks')
        .select('*')
        .order('updated_at', { ascending: false });
      
      if (error) throw error;
      return (data || []).map(mapPlaybookFromDb);
    },
  });
};

export const useTogglePlaybook = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from('playbooks')
        .update({ enabled })
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playbooks'] });
    },
  });
};

export const useDeletePlaybook = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('playbooks')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playbooks'] });
    },
  });
};
