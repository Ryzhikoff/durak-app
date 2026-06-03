import { api } from '@/lib/api';
import type {
  AdminUserDTO,
  AdminUserListQuery,
  AdminUserListResponse,
  CreateAdminUserRequest,
  ResetPasswordRequest,
  UpdateAdminUserRequest,
} from '@durak/shared-types';

export async function listUsers(query: AdminUserListQuery): Promise<AdminUserListResponse> {
  const res = await api.get<AdminUserListResponse>('/admin/users', { params: query });
  return res.data;
}

export async function createUser(body: CreateAdminUserRequest): Promise<AdminUserDTO> {
  const res = await api.post<AdminUserDTO>('/admin/users', body);
  return res.data;
}

export async function updateUser(
  id: string,
  patch: UpdateAdminUserRequest,
): Promise<AdminUserDTO> {
  const res = await api.patch<AdminUserDTO>(`/admin/users/${id}`, patch);
  return res.data;
}

export async function resetUserPassword(
  id: string,
  body: ResetPasswordRequest,
): Promise<void> {
  await api.post(`/admin/users/${id}/reset-password`, body);
}

export async function deleteUser(id: string): Promise<void> {
  await api.delete(`/admin/users/${id}`);
}
