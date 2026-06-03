import { api } from '@/lib/api';
import type {
  GameDetail,
  GameListQuery,
  GameListResponse,
} from '@durak/shared-types';

export async function listGames(query: GameListQuery): Promise<GameListResponse> {
  const res = await api.get<GameListResponse>('/games', { params: query });
  return res.data;
}

export async function fetchGame(id: string): Promise<GameDetail> {
  const res = await api.get<GameDetail>(`/games/${id}`);
  return res.data;
}
