import { api } from '@/lib/api';
import type {
  GameListQuery,
  GameListResponse,
} from '@durak/shared-types';
import type { ClientGameState } from './types';

export async function listGames(query: GameListQuery): Promise<GameListResponse> {
  const res = await api.get<GameListResponse>('/games', { params: query });
  return res.data;
}

/**
 * Fetches the personalised live-game snapshot. Phase 5 backend wraps the
 * response in `{ state }` (matches the WS shape so the client can reuse
 * code paths). Membership is enforced server-side; non-members get 404
 * `GAME_NOT_FOUND`.
 */
export async function fetchGame(id: string): Promise<ClientGameState> {
  const res = await api.get<{ state: ClientGameState }>(`/games/${id}`);
  return res.data.state;
}
