import { api } from '@/lib/api';
import type {
  AuthMeResponse,
  PublicProfile,
  UpdateMeRequest,
  User,
} from '@durak/shared-types';

export async function updateMe(body: UpdateMeRequest): Promise<User> {
  const res = await api.patch<AuthMeResponse>('/me', body);
  return res.data.user;
}

export async function fetchPublicProfile(id: string): Promise<PublicProfile> {
  const res = await api.get<PublicProfile>(`/users/${id}/profile`);
  return res.data;
}

export async function uploadAvatar(file: File): Promise<User> {
  const form = new FormData();
  form.append('file', file);
  // Let axios/browser set Content-Type with the correct multipart boundary.
  const res = await api.post<AuthMeResponse>('/me/avatar', form);
  return res.data.user;
}

export async function deleteAvatar(): Promise<User> {
  const res = await api.delete<AuthMeResponse>('/me/avatar');
  return res.data.user;
}

export async function uploadCardBack(file: File): Promise<User> {
  const form = new FormData();
  form.append('file', file);
  const res = await api.post<AuthMeResponse>('/me/card-back', form);
  return res.data.user;
}

export async function deleteCardBack(): Promise<User> {
  const res = await api.delete<AuthMeResponse>('/me/card-back');
  return res.data.user;
}
