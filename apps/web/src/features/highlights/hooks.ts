import { useQuery } from '@tanstack/react-query';
import { fetchHighlights } from './api';

export const HIGHLIGHTS_QUERY_KEY = 'highlights' as const;

/** TanStack Query hook for `GET /api/highlights`. */
export function useHighlights() {
  return useQuery({
    queryKey: [HIGHLIGHTS_QUERY_KEY],
    queryFn: () => fetchHighlights(),
    staleTime: 60_000,
  });
}
