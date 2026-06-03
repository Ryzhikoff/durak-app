import { api } from '@/lib/api';
import type {
  AuthLoginResponse,
  AuthMeResponse,
  ChangePasswordRequest,
  LoginRequest,
  User,
} from '@durak/shared-types';

export async function fetchMe(): Promise<User> {
  const res = await api.get<AuthMeResponse>('/auth/me');
  return res.data.user;
}

export async function login(body: LoginRequest): Promise<User> {
  const res = await api.post<AuthLoginResponse>('/auth/login', body);
  return res.data.user;
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout');
}

export async function changePassword(body: ChangePasswordRequest): Promise<User> {
  const res = await api.post<AuthLoginResponse>('/auth/change-password', body);
  return res.data.user;
}
