import { useQuery } from '@tanstack/react-query';
import { listRating } from './api';
import type { RatingListQuery } from '@durak/shared-types';

export const RATING_QUERY_KEY = 'rating' as const;

export function useRating(query: RatingListQuery) {
  return useQuery({
    queryKey: [RATING_QUERY_KEY, query],
    queryFn: () => listRating(query),
    staleTime: 15_000,
  });
}
