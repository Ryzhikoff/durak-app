/**
 * Public (game-side) REST surface for the enabled text-reaction list. The
 * matching admin surface lives in `features/admin/textReactionsApi.ts` and
 * mutates the same backend rows; the two TanStack-Query keys are kept
 * separate so admin edits never leak disabled rows into the picker.
 */
import { api } from '@/lib/api';
import type { TextReaction, TextReactionsResponse } from '@durak/shared-types';

/** TanStack-Query key for the public enabled-only text-reaction list. */
export const TEXT_REACTIONS_QUERY_KEY = ['text-reactions'] as const;

export async function fetchTextReactions(): Promise<TextReaction[]> {
  const res = await api.get<TextReactionsResponse>('/text-reactions');
  return res.data.reactions;
}
