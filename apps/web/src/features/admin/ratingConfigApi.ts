/**
 * Admin-only REST surface for the TrueSkill rating configuration.
 *
 * GET  /api/admin/rating-config   — current values.
 * PATCH /api/admin/rating-config  — partial update (any subset of fields).
 */
import { api } from '@/lib/api';
import type {
  RatingConfig,
  UpdateRatingConfigRequest,
} from '@durak/shared-types';

export async function fetchRatingConfig(): Promise<RatingConfig> {
  const res = await api.get<RatingConfig>('/admin/rating-config');
  return res.data;
}

export async function updateRatingConfig(
  body: UpdateRatingConfigRequest,
): Promise<RatingConfig> {
  const res = await api.patch<RatingConfig>('/admin/rating-config', body);
  return res.data;
}
