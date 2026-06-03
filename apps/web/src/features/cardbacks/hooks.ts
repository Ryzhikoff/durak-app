import { useQuery } from '@tanstack/react-query';
import { fetchCardBacks } from './api';

export const CARD_BACKS_QUERY_KEY = ['card-backs'] as const;

export function useCardBacks() {
  return useQuery({
    queryKey: CARD_BACKS_QUERY_KEY,
    queryFn: fetchCardBacks,
    // Definitions are static-ish; cache for the session.
    staleTime: 60 * 60 * 1000,
  });
}
