import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createUser,
  deleteUser,
  listUsers,
  resetUserPassword,
  updateUser,
} from './api';
import type {
  AdminUserListQuery,
  CreateAdminUserRequest,
  ResetPasswordRequest,
  UpdateAdminUserRequest,
} from '@durak/shared-types';

export const ADMIN_USERS_KEY = 'admin-users' as const;

export function useAdminUsers(query: AdminUserListQuery) {
  return useQuery({
    queryKey: [ADMIN_USERS_KEY, query],
    queryFn: () => listUsers(query),
    staleTime: 10_000,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAdminUserRequest) => createUser(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: [ADMIN_USERS_KEY] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; patch: UpdateAdminUserRequest }) =>
      updateUser(vars.id, vars.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: [ADMIN_USERS_KEY] }),
  });
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: (vars: { id: string; body: ResetPasswordRequest }) =>
      resetUserPassword(vars.id, vars.body),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [ADMIN_USERS_KEY] }),
  });
}
