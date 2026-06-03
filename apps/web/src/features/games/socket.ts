/**
 * Socket.IO client for the `/games` namespace.
 *
 * Mirrors the lobbies-socket pattern: module-singleton, `autoConnect: false`,
 * cookie-based auth via the existing session. Components opt in via
 * {@link useGameSocket} which ref-counts the connection so multiple consumers
 * share one transport.
 */
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { GAME_EVENTS, GAME_NAMESPACE } from '@durak/shared-types';
import { emitWithAck } from '@/lib/socket';
import type { GameCommand, GameSubscribePayload } from './types';

export const gamesSocket: Socket = io(GAME_NAMESPACE, {
  withCredentials: true,
  autoConnect: false,
  transports: ['websocket', 'polling'],
});

let refCount = 0;

export function connectGames(): void {
  refCount += 1;
  if (!gamesSocket.connected) {
    gamesSocket.connect();
  }
}

export function disconnectGames(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && gamesSocket.connected) {
    gamesSocket.disconnect();
  }
}

export function useGameSocket(): Socket {
  useEffect(() => {
    connectGames();
    return () => {
      disconnectGames();
    };
  }, []);
  return gamesSocket;
}

// -------- typed wrappers --------

export function subscribeGame(gameId: string): Promise<GameSubscribePayload> {
  return emitWithAck(gamesSocket, GAME_EVENTS.subscribe, { gameId });
}

export function sendGameCommand(
  gameId: string,
  command: GameCommand,
): Promise<{ ok: true }> {
  return emitWithAck(gamesSocket, GAME_EVENTS.command, { gameId, command });
}
