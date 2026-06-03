import { api } from '@/lib/api';
import type { Lobby, LobbySettings, LobbySummary } from '@durak/shared-types';

/** Creates a lobby owned by the current user with optional setting overrides. */
export async function createLobby(
  settings?: Partial<LobbySettings>,
): Promise<Lobby> {
  const res = await api.post<{ lobby: Lobby }>('/lobbies', { settings });
  return res.data.lobby;
}

/** Open lobbies (waiting + starting only) — initial bootstrap before WS kicks in. */
export async function listLobbies(): Promise<LobbySummary[]> {
  const res = await api.get<{ items: LobbySummary[] }>('/lobbies');
  return res.data.items;
}

/** Single lobby snapshot. Used to render before WS state arrives. */
export async function fetchLobby(id: string): Promise<Lobby> {
  const res = await api.get<{ lobby: Lobby }>(`/lobbies/${id}`);
  return res.data.lobby;
}

/**
 * REST escape hatch for force-leaving the lobby the caller is currently in.
 * 204 either way (already-out is success). Used when a stale WS connection
 * leaves the user "stuck" between the per-user `userInLobby` reverse-index
 * and the actual lobby state.
 */
export async function leaveCurrentLobby(): Promise<void> {
  await api.post('/lobbies/leave');
}
