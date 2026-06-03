import { useQuery } from '@tanstack/react-query';
import { fetchGame, listGames } from './api';
import type { GameListQuery } from '@durak/shared-types';

export const GAMES_QUERY_KEY = 'games' as const;

export function useGames(query: GameListQuery) {
  return useQuery({
    queryKey: [GAMES_QUERY_KEY, query],
    queryFn: () => listGames(query),
    staleTime: 15_000,
  });
}

export function useGame(id: string | undefined) {
  return useQuery({
    queryKey: [GAMES_QUERY_KEY, 'detail', id],
    queryFn: () => fetchGame(id as string),
    enabled: !!id,
    retry: false,
  });
}
