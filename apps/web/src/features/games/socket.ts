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
import type {
  ChatMessage,
  ChatReactionUpdate,
  GameCommand,
  GameSubscribePayload,
  PauseVote,
} from './types';

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

export function sendChatMessage(
  gameId: string,
  text: string,
  replyToId?: string,
): Promise<{ message: ChatMessage }> {
  const payload: { gameId: string; text: string; replyToId?: string } = {
    gameId,
    text,
  };
  if (replyToId) payload.replyToId = replyToId;
  return emitWithAck(gamesSocket, GAME_EVENTS.chatSend, payload);
}

export function fetchChatHistory(
  gameId: string,
): Promise<{ messages: ChatMessage[] }> {
  return emitWithAck(gamesSocket, GAME_EVENTS.chatFetch, { gameId });
}

export function sendChatReaction(
  gameId: string,
  messageId: string,
  emoji: string | null,
): Promise<ChatReactionUpdate> {
  return emitWithAck(gamesSocket, GAME_EVENTS.chatReact, {
    gameId,
    messageId,
    emoji,
  });
}

/**
 * Phase 8 — cast a vote during the disconnect-pause's voting window. Resolves
 * with `{ ok: true }`; rejects with a `SocketAckError` carrying the server
 * code (`VOTE_NOT_ALLOWED`, `GAME_NOT_FOUND`, …) when the vote is refused.
 */
export function sendPauseVote(
  gameId: string,
  vote: PauseVote,
): Promise<{ ok: true }> {
  return emitWithAck(gamesSocket, GAME_EVENTS.pauseVote, { gameId, vote });
}

/**
 * Fire a seat-side emoji reaction. The server broadcasts it back to every
 * client in the game (including the sender), and clients render an ephemeral
 * floating bubble over the corresponding seat for ~2.5s.
 */
export function sendPlayerReaction(
  gameId: string,
  emoji: string,
): Promise<{ ok: true }> {
  return emitWithAck(gamesSocket, GAME_EVENTS.reactionSend, { gameId, emoji });
}

/**
 * Fire a seat-side TEXT reaction. The picker shows phrases from the admin-
 * managed list; we ship the row id and let the server resolve it back to
 * canonical text so no client can broadcast an arbitrary phrase. Shares the
 * same per-user rate-limit bucket as `sendPlayerReaction` (one bubble of
 * either kind per 1.5s window).
 */
export function sendPlayerTextReaction(
  gameId: string,
  textReactionId: string,
): Promise<{ ok: true }> {
  return emitWithAck(gamesSocket, GAME_EVENTS.textReactionSend, {
    gameId,
    textReactionId,
  });
}
