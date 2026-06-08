import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FaceCardAsset, FaceCardRank, FaceCardSuit } from '@durak/shared-types';
import {
  deleteFaceCard,
  fetchAdminFaceCards,
  uploadFaceCard,
} from '@/features/games/faceCardsApi';
import { FACE_CARDS_QUERY_KEY } from '@/features/games/hooks';

export const ADMIN_FACE_CARDS_QUERY_KEY = ['admin', 'face-cards'] as const;

/**
 * Admin grid bootstrap. Lives under a separate key from the public
 * {@link FACE_CARDS_QUERY_KEY} so the admin page doesn't accidentally serve
 * stale data while the game page is still using the cached public list.
 */
export function useAdminFaceCards() {
  return useQuery<FaceCardAsset[]>({
    queryKey: ADMIN_FACE_CARDS_QUERY_KEY,
    queryFn: fetchAdminFaceCards,
    staleTime: 30_000,
  });
}

interface UploadVars {
  rank: FaceCardRank;
  suit: FaceCardSuit;
  file: File;
}

/**
 * Upload mutation. Updates both the admin and the public cache on success so
 * every connected client picks up the new image without a manual refetch.
 */
export function useUploadFaceCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rank, suit, file }: UploadVars) => uploadFaceCard(rank, suit, file),
    onSuccess: (asset) => {
      mergeIntoCache(qc, asset);
    },
  });
}

interface DeleteVars {
  rank: FaceCardRank;
  suit: FaceCardSuit;
}

export function useDeleteFaceCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rank, suit }: DeleteVars) => deleteFaceCard(rank, suit),
    onSuccess: (asset) => {
      mergeIntoCache(qc, asset);
    },
  });
}

/**
 * Merge a single (rank, suit) row into both caches. We patch in-place rather
 * than invalidating to avoid the visible flash from a refetch — the server
 * just told us what the new state is, so the cache can mirror it directly.
 */
function mergeIntoCache(qc: ReturnType<typeof useQueryClient>, asset: FaceCardAsset) {
  const update = (prev: FaceCardAsset[] | undefined): FaceCardAsset[] => {
    if (!prev) return [asset];
    let touched = false;
    const next = prev.map((a) => {
      if (a.rank === asset.rank && a.suit === asset.suit) {
        touched = true;
        return asset;
      }
      return a;
    });
    return touched ? next : [...next, asset];
  };
  qc.setQueryData<FaceCardAsset[]>(ADMIN_FACE_CARDS_QUERY_KEY, update);
  qc.setQueryData<FaceCardAsset[]>(FACE_CARDS_QUERY_KEY, update);
}
