import { AppRole } from '@/hooks/useUserRole';

export interface FeaturePermission {
  view: AppRole[];
  edit?: AppRole[];
  delete?: AppRole[];
}

// Define which roles can access which features
export const FEATURE_PERMISSIONS: Record<string, FeaturePermission> = {
  // Alerts - all roles can view, senior+ can edit/acknowledge
  alerts: {
    view: ['admin', 'senior_analyst', 'analyst'],
    edit: ['admin', 'senior_analyst'],
  },
  
  // Playbooks - all can view, senior+ can edit, admin can delete
  playbooks: {
    view: ['admin', 'senior_analyst', 'analyst'],
    edit: ['admin', 'senior_analyst'],
    delete: ['admin'],
  },
  
  // Executions - all can view
  executions: {
    view: ['admin', 'senior_analyst', 'analyst'],
  },
  
  // Approvals - senior+ only
  approvals: {
    view: ['admin', 'senior_analyst'],
    edit: ['admin', 'senior_analyst'],
  },
  
  // Connectors - admin only
  connectors: {
    view: ['admin'],
    edit: ['admin'],
    delete: ['admin'],
  },
  
  // Audit Log - senior+ can view
  audit: {
    view: ['admin', 'senior_analyst'],
  },
  
  // Metrics - all can view
  metrics: {
    view: ['admin', 'senior_analyst', 'analyst'],
  },
  
  // Settings - admin only
  settings: {
    view: ['admin'],
    edit: ['admin'],
  },

  // Cases - all can view, senior+ can edit
  cases: {
    view: ['admin', 'senior_analyst', 'analyst'],
    edit: ['admin', 'senior_analyst'],
  },

  // User management - admin only
  userManagement: {
    view: ['admin'],
    edit: ['admin'],
    delete: ['admin'],
  },
};

export const canViewFeature = (feature: string, role: AppRole | null): boolean => {
  if (!role) return false;
  const permission = FEATURE_PERMISSIONS[feature];
  if (!permission) return false;
  return permission.view.includes(role);
};

export const canEditFeature = (feature: string, role: AppRole | null): boolean => {
  if (!role) return false;
  const permission = FEATURE_PERMISSIONS[feature];
  if (!permission || !permission.edit) return false;
  return permission.edit.includes(role);
};

export const canDeleteFeature = (feature: string, role: AppRole | null): boolean => {
  if (!role) return false;
  const permission = FEATURE_PERMISSIONS[feature];
  if (!permission || !permission.delete) return false;
  return permission.delete.includes(role);
};
