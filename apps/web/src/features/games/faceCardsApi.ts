/**
 * Face-card asset REST surface.
 *
 *  - `GET    /face-cards`                — public, used by every client to
 *                                          decorate J/Q/K rendering.
 *  - `GET    /admin/face-cards`          — admin grid bootstrap (12 slots).
 *  - `POST   /admin/face-cards/:r/:s`    — multipart upload (overwrites).
 *  - `DELETE /admin/face-cards/:r/:s`    — clear → revert to default SVG.
 */
import { api } from '@/lib/api';
import type {
  FaceCardAsset,
  FaceCardRank,
  FaceCardSuit,
  FaceCardsResponse,
} from '@durak/shared-types';

export async function fetchFaceCards(): Promise<FaceCardAsset[]> {
  const res = await api.get<FaceCardsResponse>('/face-cards');
  return res.data.assets;
}

export async function fetchAdminFaceCards(): Promise<FaceCardAsset[]> {
  const res = await api.get<FaceCardsResponse>('/admin/face-cards');
  return res.data.assets;
}

export async function uploadFaceCard(
  rank: FaceCardRank,
  suit: FaceCardSuit,
  file: File,
): Promise<FaceCardAsset> {
  const form = new FormData();
  form.append('file', file);
  const res = await api.post<FaceCardAsset>(
    `/admin/face-cards/${rank}/${suit}`,
    form,
  );
  return res.data;
}

export async function deleteFaceCard(
  rank: FaceCardRank,
  suit: FaceCardSuit,
): Promise<FaceCardAsset> {
  const res = await api.delete<FaceCardAsset>(`/admin/face-cards/${rank}/${suit}`);
  return res.data;
}
