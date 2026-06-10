/**
 * Owner-scoped REST surface for per-user custom text reactions. Lives next to
 * the admin-managed `textReactionsApi.ts` because the in-game picker merges
 * both sources; the profile page imports the same helpers to manage the list.
 *
 * Cache contract:
 *   - The query key (`['me-text-reactions']`) is independent of the public
 *     admin list — admin edits never invalidate the user list, and vice-versa.
 *   - The current viewer never sees another user's customs, so the query is
 *     unkeyed by userId — it always returns the caller's own rows.
 */
import { api } from '@/lib/api';
import type {
  CreateUserTextReactionRequest,
  UpdateUserTextReactionRequest,
  UserTextReactionDTO,
  UserTextReactionsResponse,
} from '@durak/shared-types';

/** TanStack-Query key for the current user's custom text reactions. */
export const ME_TEXT_REACTIONS_QUERY_KEY = ['me-text-reactions'] as const;

export async function fetchMyTextReactions(): Promise<UserTextReactionDTO[]> {
  const res = await api.get<UserTextReactionsResponse>('/me/text-reactions');
  return res.data.reactions;
}

export async function createMyTextReaction(
  body: CreateUserTextReactionRequest,
): Promise<UserTextReactionDTO> {
  const res = await api.post<UserTextReactionDTO>('/me/text-reactions', body);
  return res.data;
}

export async function updateMyTextReaction(
  id: string,
  body: UpdateUserTextReactionRequest,
): Promise<UserTextReactionDTO> {
  const res = await api.patch<UserTextReactionDTO>(`/me/text-reactions/${id}`, body);
  return res.data;
}

export async function deleteMyTextReaction(id: string): Promise<{ id: string }> {
  const res = await api.delete<{ id: string }>(`/me/text-reactions/${id}`);
  return res.data;
}
