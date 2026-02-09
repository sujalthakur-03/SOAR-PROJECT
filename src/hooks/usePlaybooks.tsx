import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface Playbook {
  id: string;  // Normalized: uses playbook_id from backend
  playbook_id?: string;  // Original backend field
  name: string;
  description: string | null;
  enabled: boolean;
  version: number;
  trigger?: Record<string, unknown> | null; // Extracted from dsl.trigger
  steps: Record<string, unknown>[];  // Extracted from dsl.steps
  executionCount?: number;  // Frontend camelCase alias
  execution_count?: number; // Backend snake_case
  lastExecution?: string | null;  // Frontend camelCase alias
  last_execution?: string | null; // Backend snake_case
  created_at: string;
  updated_at: string;
}

/**
 * Normalize backend playbook response to frontend format
 * - Maps playbook_id to id for frontend compatibility
 * - Extracts trigger/steps from dsl object
 */
function normalizePlaybook(raw: any): Playbook {
  const dsl = raw.dsl || {};
  return {
    id: raw.playbook_id || raw.id || raw._id,  // Use playbook_id as primary ID
    playbook_id: raw.playbook_id,
    name: raw.name || '',
    description: raw.description || null,
    enabled: raw.enabled ?? true,
    version: raw.version || 1,
    trigger: dsl.trigger || raw.trigger || null,
    steps: dsl.steps || raw.steps || [],
    executionCount: raw.execution_count || raw.executionCount || 0,
    execution_count: raw.execution_count || 0,
    lastExecution: raw.last_execution || raw.lastExecution || null,
    last_execution: raw.last_execution || null,
    created_at: raw.created_at || new Date().toISOString(),
    updated_at: raw.updated_at || new Date().toISOString(),
  };
}

export const usePlaybooks = () => {
  return useQuery({
    queryKey: ['playbooks'],
    queryFn: async () => {
      const allVersions = await apiClient.getPlaybooks();
      const normalized = allVersions.map(normalizePlaybook);

      // Deduplicate: keep only the latest version per playbook_id.
      // The API returns all versions (enabled + disabled) so that
      // disabled playbooks remain visible with their toggle off.
      const latestByPlaybookId = new Map<string, Playbook>();
      for (const pb of normalized) {
        const existing = latestByPlaybookId.get(pb.id);
        if (!existing || pb.version > existing.version) {
          latestByPlaybookId.set(pb.id, pb);
        }
      }

      return Array.from(latestByPlaybookId.values());
    },
  });
};

export const useTogglePlaybook = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, enabled, version }: { id: string; enabled: boolean; version?: number }) => {
      return apiClient.togglePlaybook(id, enabled, version);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playbooks'] });
    },
  });
};

export const useDeletePlaybook = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.deletePlaybook(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playbooks'] });
    },
  });
};

export const useCreatePlaybook = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      name: string;
      description: string;
      trigger: Record<string, unknown>;
      steps: Record<string, unknown>[];
    }) => apiClient.createPlaybook(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playbooks'] });
    },
  });
};

export const useUpdatePlaybook = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
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
    }) => apiClient.updatePlaybook(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playbooks'] });
    },
  });
};

// ============================================================================
// WEBHOOKS & TRIGGERS
// ============================================================================

export const usePlaybookWebhook = (playbookId: string | undefined) => {
  return useQuery({
    queryKey: ['playbook-webhook', playbookId],
    queryFn: () => apiClient.getPlaybookWebhook(playbookId!),
    enabled: !!playbookId,
    retry: false,
  });
};

export const useCreateWebhook = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ playbookId, trigger }: { playbookId: string; trigger?: any }) =>
      apiClient.createPlaybookWebhook(playbookId, trigger),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['playbook-webhook', variables.playbookId] });
    },
  });
};

export const useCreateTrigger = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ playbookId, triggerDef }: { playbookId: string; triggerDef: any }) =>
      apiClient.createOrUpdateTrigger(playbookId, triggerDef),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['playbook-webhook', variables.playbookId] });
    },
  });
};
