import { api } from '@/lib/api';
import type {
  AdminSetupRequest,
  AdminSetupStatusResponse,
  AuthLoginResponse,
  User,
} from '@durak/shared-types';

export async function fetchSetupStatus(): Promise<AdminSetupStatusResponse> {
  const res = await api.get<AdminSetupStatusResponse>('/admin/setup/status');
  return res.data;
}

export async function createFirstAdmin(body: AdminSetupRequest): Promise<User> {
  const res = await api.post<AuthLoginResponse>('/admin/setup', body);
  return res.data.user;
}
