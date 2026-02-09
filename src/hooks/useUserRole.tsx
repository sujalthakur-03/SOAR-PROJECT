import { useState, useEffect } from 'react';
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
  const { user, loading: authLoading } = useAuth();
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!user) {
      setRole(null);
      setLoading(false);
      return;
    }

    // Get role directly from user object (returned by backend auth)
    const userRole = user.role as AppRole;
    setRole(userRole || 'analyst');
    setLoading(false);
  }, [user, authLoading]);

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
