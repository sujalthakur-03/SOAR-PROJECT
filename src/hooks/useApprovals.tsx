import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAuth } from './useAuth';

type ApprovalRow = Database['public']['Tables']['approvals']['Row'];

export interface Approval {
  id: string;
  approvalId: string;
  executionId: string | null;
  playbookName: string;
  alertId: string | null;
  proposedAction: string;
  actionDetails: Record<string, unknown>;
  requestedAt: string;
  expiresAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
}

const mapApprovalFromDb = (row: ApprovalRow): Approval => ({
  id: row.id,
  approvalId: row.approval_id,
  executionId: row.execution_id,
  playbookName: row.playbook_name,
  alertId: row.alert_id,
  proposedAction: row.proposed_action,
  actionDetails: (row.action_details as Record<string, unknown>) || {},
  requestedAt: row.requested_at,
  expiresAt: row.expires_at,
  status: row.status as Approval['status'],
  decidedBy: row.decided_by,
  decidedAt: row.decided_at,
  reason: row.reason,
});

export const useApprovals = () => {
  return useQuery({
    queryKey: ['approvals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('approvals')
        .select('*')
        .order('requested_at', { ascending: false });
      
      if (error) throw error;
      return (data || []).map(mapApprovalFromDb);
    },
  });
};

export const useApproveAction = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const { error } = await supabase
        .from('approvals')
        .update({ 
          status: 'approved' as const,
          decided_by: user?.id,
          decided_at: new Date().toISOString(),
          reason 
        })
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
};

export const useRejectAction = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase
        .from('approvals')
        .update({ 
          status: 'rejected' as const,
          decided_by: user?.id,
          decided_at: new Date().toISOString(),
          reason 
        })
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
};
