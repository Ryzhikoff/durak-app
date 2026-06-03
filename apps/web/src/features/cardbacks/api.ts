import { api } from '@/lib/api';
import type { CardBacksListResponse } from '@durak/shared-types';

export async function fetchCardBacks(): Promise<CardBacksListResponse> {
  const res = await api.get<CardBacksListResponse>('/card-backs');
  return res.data;
}
