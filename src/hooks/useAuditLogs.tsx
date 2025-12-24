import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type AuditLogRow = Database['public']['Tables']['audit_logs']['Row'];

export interface AuditEntry {
  id: string;
  timestamp: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details: Record<string, unknown>;
  ipAddress: string | null;
  outcome: string;
}

const mapAuditLogFromDb = (row: AuditLogRow): AuditEntry => ({
  id: row.id,
  timestamp: row.timestamp,
  actorEmail: row.actor_email,
  actorRole: row.actor_role,
  action: row.action,
  resourceType: row.resource_type,
  resourceId: row.resource_id,
  details: (row.details as Record<string, unknown>) || {},
  ipAddress: row.ip_address,
  outcome: row.outcome,
});

export const useAuditLogs = () => {
  return useQuery({
    queryKey: ['audit_logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(100);
      
      if (error) throw error;
      return (data || []).map(mapAuditLogFromDb);
    },
  });
};
