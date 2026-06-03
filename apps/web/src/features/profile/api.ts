import { api } from '@/lib/api';
import type { AuthMeResponse, UpdateMeRequest, User } from '@durak/shared-types';

export async function updateMe(body: UpdateMeRequest): Promise<User> {
  const res = await api.patch<AuthMeResponse>('/me', body);
  return res.data.user;
}
