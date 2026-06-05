import { api } from '@/lib/api';
import type { HighlightsResponse } from '@durak/shared-types';

export async function fetchHighlights(): Promise<HighlightsResponse> {
  const res = await api.get<HighlightsResponse>('/highlights');
  return res.data;
}
