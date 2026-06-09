/**
 * Admin REST surface for the preset text-reaction list.
 *
 *  - `GET    /admin/text-reactions`       — full list (enabled + disabled).
 *  - `POST   /admin/text-reactions`       — create.
 *  - `PATCH  /admin/text-reactions/:id`   — partial update.
 *  - `DELETE /admin/text-reactions/:id`   — drop a row.
 *
 * The public `GET /text-reactions` endpoint is consumed from
 * `features/games/textReactionsApi.ts` — keeping the surfaces separate so the
 * admin page never accidentally serves stale enabled-only data.
 */
import { api } from '@/lib/api';
import type {
  AdminCreateTextReactionRequest,
  AdminTextReactionDTO,
  AdminTextReactionsResponse,
  AdminUpdateTextReactionRequest,
} from '@durak/shared-types';

export async function fetchAdminTextReactions(): Promise<AdminTextReactionDTO[]> {
  const res = await api.get<AdminTextReactionsResponse>('/admin/text-reactions');
  return res.data.reactions;
}

export async function createTextReaction(
  body: AdminCreateTextReactionRequest,
): Promise<AdminTextReactionDTO> {
  const res = await api.post<AdminTextReactionDTO>('/admin/text-reactions', body);
  return res.data;
}

export async function updateTextReaction(
  id: string,
  body: AdminUpdateTextReactionRequest,
): Promise<AdminTextReactionDTO> {
  const res = await api.patch<AdminTextReactionDTO>(`/admin/text-reactions/${id}`, body);
  return res.data;
}

export async function deleteTextReaction(id: string): Promise<{ id: string }> {
  const res = await api.delete<{ id: string }>(`/admin/text-reactions/${id}`);
  return res.data;
}
