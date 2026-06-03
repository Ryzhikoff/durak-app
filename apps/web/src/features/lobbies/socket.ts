/**
 * Thin typed wrappers around the lobby WS events. Component code should call
 * these helpers instead of `socket.emit` to keep payload shapes consistent
 * with the gateway.
 */
import {
  LOBBY_EVENTS,
  type Lobby,
  type LobbySettings,
  type LobbySummary,
} from '@durak/shared-types';
import { emitWithAck, lobbiesSocket } from '@/lib/socket';

export function subscribeLobbies(): Promise<{ items: LobbySummary[] }> {
  return emitWithAck(lobbiesSocket, LOBBY_EVENTS.subscribe);
}

export function unsubscribeLobbies(): Promise<{ ok: true }> {
  return emitWithAck(lobbiesSocket, LOBBY_EVENTS.unsubscribe);
}

export function joinLobby(lobbyId: string): Promise<{ lobby: Lobby }> {
  return emitWithAck(lobbiesSocket, LOBBY_EVENTS.join, { lobbyId });
}

export function leaveLobby(lobbyId: string): Promise<{ ok: true }> {
  return emitWithAck(lobbiesSocket, LOBBY_EVENTS.leave, { lobbyId });
}

export function updateLobbySettings(
  lobbyId: string,
  settings: Partial<LobbySettings>,
): Promise<{ lobby: Lobby }> {
  return emitWithAck(lobbiesSocket, LOBBY_EVENTS.updateSettings, {
    lobbyId,
    settings,
  });
}

export function setLobbyReady(
  lobbyId: string,
  ready: boolean,
): Promise<{ lobby: Lobby }> {
  return emitWithAck(lobbiesSocket, LOBBY_EVENTS.setReady, { lobbyId, ready });
}

export function startLobby(
  lobbyId: string,
): Promise<{ lobby: Lobby; gameId: string }> {
  return emitWithAck(lobbiesSocket, LOBBY_EVENTS.start, { lobbyId });
}
