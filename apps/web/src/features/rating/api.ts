import { api } from '@/lib/api';
import type { RatingListQuery, RatingListResponse } from '@durak/shared-types';

export async function listRating(query: RatingListQuery): Promise<RatingListResponse> {
  const res = await api.get<RatingListResponse>('/rating', { params: query });
  return res.data;
}
