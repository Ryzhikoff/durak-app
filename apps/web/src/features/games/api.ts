import { api } from '@/lib/api';
import type {
  GameDetail,
  GameListQuery,
  GameListResponse,
  PauseInfo,
  SameCompositionResponse,
} from '@durak/shared-types';
import type { ClientGameState } from './types';

export async function listGames(query: GameListQuery): Promise<GameListResponse> {
  const res = await api.get<GameListResponse>('/games', { params: query });
  return res.data;
}

/**
 * Phase 7B — discriminated payload returned by `GET /games/:id`. Active games
 * yield `{ state }` (the personalised live snapshot); finished games yield
 * `{ detail }` (the public Postgres detail). 404 GAME_NOT_FOUND for anything
 * else.
 */
export type FetchGameResponse =
  | { kind: 'live'; state: ClientGameState; pauseInfo: PauseInfo | null }
  | { kind: 'finished'; detail: GameDetail };

/**
 * Fetches game info from the API and discriminates between live and finished.
 * Membership for the live branch is enforced server-side; non-members of an
 * active game still see the public {@link GameDetail} (Phase 7A behaviour) or
 * a 404 (Phase 5 behaviour while it's still in Redis). 404 GAME_NOT_FOUND
 * propagates as an axios error so callers can route to NotFound.
 *
 * Phase 8: live response carries the current {@link PauseInfo} (or null) so the
 * page can render the disconnect-pause overlay without waiting for the WS
 * subscribe ack — avoids a flicker between REST hydrate and WS handshake.
 */
export async function fetchGame(id: string): Promise<FetchGameResponse> {
  const res = await api.get<{
    state?: ClientGameState;
    pauseInfo?: PauseInfo | null;
    detail?: GameDetail;
  }>(`/games/${id}`);
  if (res.data.state)
    return { kind: 'live', state: res.data.state, pauseInfo: res.data.pauseInfo ?? null };
  if (res.data.detail) return { kind: 'finished', detail: res.data.detail };
  throw new Error('GAME_RESPONSE_MALFORMED');
}

/** Phase 7B — past games played by the same set of participants. */
export async function fetchSameComposition(
  id: string,
  limit?: number,
): Promise<SameCompositionResponse> {
  const res = await api.get<SameCompositionResponse>(
    `/games/${id}/same-composition`,
    { params: limit ? { limit } : undefined },
  );
  return res.data;
}
