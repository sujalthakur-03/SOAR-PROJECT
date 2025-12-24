import { createContext, useContext, ReactNode } from 'react';
import { useUserRole, AppRole } from '@/hooks/useUserRole';
import { canViewFeature, canEditFeature, canDeleteFeature } from '@/lib/permissions';

interface PermissionContextType {
  role: AppRole | null;
  loading: boolean;
  canView: (feature: string) => boolean;
  canEdit: (feature: string) => boolean;
  canDelete: (feature: string) => boolean;
}

const PermissionContext = createContext<PermissionContextType | undefined>(undefined);

export const PermissionProvider = ({ children }: { children: ReactNode }) => {
  const { role, loading } = useUserRole();

  const canView = (feature: string) => canViewFeature(feature, role);
  const canEdit = (feature: string) => canEditFeature(feature, role);
  const canDelete = (feature: string) => canDeleteFeature(feature, role);

  return (
    <PermissionContext.Provider value={{ role, loading, canView, canEdit, canDelete }}>
      {children}
    </PermissionContext.Provider>
  );
};

export const usePermissions = () => {
  const context = useContext(PermissionContext);
  if (context === undefined) {
    throw new Error('usePermissions must be used within a PermissionProvider');
  }
  return context;
};

// Component wrapper for permission-based rendering
interface RequirePermissionProps {
  feature: string;
  action?: 'view' | 'edit' | 'delete';
  children: ReactNode;
  fallback?: ReactNode;
}

export const RequirePermission = ({ 
  feature, 
  action = 'view', 
  children, 
  fallback = null 
}: RequirePermissionProps) => {
  const { canView, canEdit, canDelete, loading } = usePermissions();

  if (loading) return null;

  let hasPermission = false;
  switch (action) {
    case 'view':
      hasPermission = canView(feature);
      break;
    case 'edit':
      hasPermission = canEdit(feature);
      break;
    case 'delete':
      hasPermission = canDelete(feature);
      break;
  }

  return hasPermission ? <>{children}</> : <>{fallback}</>;
};
