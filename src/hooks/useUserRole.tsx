import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export type AppRole = 'admin' | 'senior_analyst' | 'analyst';

interface UseUserRoleReturn {
  role: AppRole | null;
  loading: boolean;
  isAdmin: boolean;
  isSeniorAnalyst: boolean;
  isAnalyst: boolean;
  hasPermission: (allowedRoles: AppRole[]) => boolean;
}

export const useUserRole = (): UseUserRoleReturn => {
  const { user } = useAuth();
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRole = async () => {
      if (!user) {
        setRole(null);
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .rpc('get_user_role', { _user_id: user.id });

        if (error) {
          console.error('Error fetching user role:', error);
          setRole('analyst'); // Default to analyst if error
        } else {
          setRole(data as AppRole || 'analyst');
        }
      } catch (err) {
        console.error('Error in role fetch:', err);
        setRole('analyst');
      } finally {
        setLoading(false);
      }
    };

    fetchRole();
  }, [user]);

  const isAdmin = role === 'admin';
  const isSeniorAnalyst = role === 'senior_analyst' || isAdmin;
  const isAnalyst = role === 'analyst' || isSeniorAnalyst;

  const hasPermission = (allowedRoles: AppRole[]) => {
    if (!role) return false;
    return allowedRoles.includes(role);
  };

  return {
    role,
    loading,
    isAdmin,
    isSeniorAnalyst,
    isAnalyst,
    hasPermission,
  };
};
