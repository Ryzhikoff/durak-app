import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminCreateTextReactionRequest,
  AdminTextReactionDTO,
  AdminUpdateTextReactionRequest,
  TextReaction,
} from '@durak/shared-types';
import {
  createTextReaction,
  deleteTextReaction,
  fetchAdminTextReactions,
  updateTextReaction,
} from './textReactionsApi';
import { TEXT_REACTIONS_QUERY_KEY } from '@/features/games/textReactionsApi';

export const ADMIN_TEXT_REACTIONS_QUERY_KEY = ['admin', 'text-reactions'] as const;

/**
 * Admin table bootstrap. Lives under a separate key from the public
 * {@link TEXT_REACTIONS_QUERY_KEY} so editing a disabled row doesn't bleed
 * "phantom" disabled phrases into the game-page picker.
 */
export function useAdminTextReactions() {
  return useQuery<AdminTextReactionDTO[]>({
    queryKey: ADMIN_TEXT_REACTIONS_QUERY_KEY,
    queryFn: fetchAdminTextReactions,
    staleTime: 30_000,
  });
}

export function useCreateTextReaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminCreateTextReactionRequest) => createTextReaction(body),
    onSuccess: (created) => {
      mergeAdmin(qc, created);
      // Invalidate the public cache so the game-page picker picks up the new
      // phrase on the next mount/focus without a manual refetch.
      qc.invalidateQueries({ queryKey: TEXT_REACTIONS_QUERY_KEY });
    },
  });
}

interface UpdateVars {
  id: string;
  patch: AdminUpdateTextReactionRequest;
}

export function useUpdateTextReaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateVars) => updateTextReaction(id, patch),
    onSuccess: (updated) => {
      mergeAdmin(qc, updated);
      qc.invalidateQueries({ queryKey: TEXT_REACTIONS_QUERY_KEY });
    },
  });
}

export function useDeleteTextReaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTextReaction(id),
    onSuccess: ({ id }) => {
      qc.setQueryData<AdminTextReactionDTO[]>(ADMIN_TEXT_REACTIONS_QUERY_KEY, (prev) =>
        (prev ?? []).filter((r) => r.id !== id),
      );
      qc.setQueryData<TextReaction[]>(TEXT_REACTIONS_QUERY_KEY, (prev) =>
        (prev ?? []).filter((r) => r.id !== id),
      );
    },
  });
}

/**
 * Patch a single row into the admin cache. The list stays sorted by
 * (sortOrder, id) — same order the server applies — so the table doesn't jump
 * around after a save.
 */
function mergeAdmin(
  qc: ReturnType<typeof useQueryClient>,
  next: AdminTextReactionDTO,
) {
  qc.setQueryData<AdminTextReactionDTO[]>(ADMIN_TEXT_REACTIONS_QUERY_KEY, (prev) => {
    if (!prev) return [next];
    const filtered = prev.filter((r) => r.id !== next.id);
    filtered.push(next);
    filtered.sort(
      (a, b) =>
        a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    return filtered;
  });
}
