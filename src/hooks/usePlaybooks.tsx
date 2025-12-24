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

export const useCreatePlaybook = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: {
      name: string;
      description: string;
      trigger: Record<string, unknown>;
      steps: Record<string, unknown>[];
    }) => {
      const playbookId = `PB-${Date.now()}`;
      const { error } = await supabase
        .from('playbooks')
        .insert([{
          playbook_id: playbookId,
          name: data.name,
          description: data.description,
          trigger: data.trigger as unknown as Database['public']['Tables']['playbooks']['Insert']['trigger'],
          steps: data.steps as unknown as Database['public']['Tables']['playbooks']['Insert']['steps'],
        }]);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playbooks'] });
    },
  });
};

export const useUpdatePlaybook = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: {
        name: string;
        description: string;
        trigger: Record<string, unknown>;
        steps: Record<string, unknown>[];
      };
    }) => {
      const { error } = await supabase
        .from('playbooks')
        .update({
          name: data.name,
          description: data.description,
          trigger: data.trigger as unknown as Database['public']['Tables']['playbooks']['Update']['trigger'],
          steps: data.steps as unknown as Database['public']['Tables']['playbooks']['Update']['steps'],
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playbooks'] });
    },
  });
};
