import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface User {
  id: string;
  _id?: string;
  username: string;
  email: string;
  fullName: string;
  role: string;
  status: 'active' | 'inactive' | 'locked';
  created_at: string;
  last_login: string | null;
}

function normalizeUser(raw: any): User {
  return {
    id: raw.id || raw._id,
    _id: raw._id,
    username: raw.username || '',
    email: raw.email || '',
    fullName: raw.fullName || '',
    role: raw.role || 'viewer',
    status: raw.status || 'active',
    created_at: raw.created_at || raw.createdAt || new Date().toISOString(),
    last_login: raw.last_login || raw.lastLogin || null,
  };
}

export const useUsers = () => {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const raw = await apiClient.getUsers();
      const users = Array.isArray(raw) ? raw : (raw as any).users || [];
      return users.map(normalizeUser);
    },
  });
};

export const useCreateUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      username: string;
      password: string;
      email: string;
      fullName: string;
      role: string;
    }) => apiClient.createUser(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
};

export const useUpdateUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: {
      id: string;
      data: {
        fullName?: string;
        email?: string;
        role?: string;
        status?: string;
      };
    }) => apiClient.updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
};

export const useDeactivateUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.deactivateUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
};

export const useResetPassword = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, newPassword }: { id: string; newPassword: string }) =>
      apiClient.resetUserPassword(id, newPassword),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
};
