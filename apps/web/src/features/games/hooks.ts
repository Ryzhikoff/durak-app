/**
 * Live-game React hooks. Source-of-truth = the WebSocket; the REST snapshot is
 * only used for the initial fetch (so the page can render before the WS
 * handshake completes).
 *
 * The game state lives in TanStack-Query cache so React renders read from a
 * single place. Incoming `game:state`/`game:events`/`game:over` events patch
 * the cache; `useGameCommand` provides the imperative outbound channel.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GAME_EVENTS } from '@durak/shared-types';
import { fetchGame, listGames } from './api';
import {
  fetchChatHistory,
  gamesSocket,
  sendChatMessage,
  sendChatReaction,
  sendGameCommand,
  subscribeGame,
  useGameSocket,
} from './socket';
import type { GameListQuery } from '@durak/shared-types';
import type {
  ChatMessage,
  ClientGameState,
  DomainEvent,
  GameChatMessageEvent,
  GameChatReactionEvent,
  GameCommand,
  GameEventsEvent,
  GameOverEvent,
  GameStateEvent,
} from './types';

export const GAMES_QUERY_KEY = 'games' as const;

/** Legacy: list of games stub (Phase 5 returns empty). Kept for forward-compat. */
export function useGames(query: GameListQuery) {
  return useQuery({
    queryKey: [GAMES_QUERY_KEY, query],
    queryFn: () => listGames(query),
    staleTime: 15_000,
  });
}

/** REST-only fetch — used while the WS handshake is pending. */
export function useGameSnapshot(id: string | undefined) {
  return useQuery({
    queryKey: [GAMES_QUERY_KEY, 'detail', id],
    queryFn: () => fetchGame(id as string),
    enabled: !!id,
    retry: false,
    staleTime: 5_000,
  });
}

const GAME_ROOM_KEY = (id: string) => [GAMES_QUERY_KEY, 'live', id] as const;
const RECENT_EVENTS_LIMIT = 50;

export interface LiveGameQueryData {
  state: ClientGameState;
  recentEvents: DomainEvent[];
  /** Events we have already toasted; the page is responsible for clearing them. */
  unseenEvents: DomainEvent[];
  /** Chat backlog kept in sync via `game:chat_message` broadcasts. */
  chatMessages: ChatMessage[];
}

const CHAT_BUFFER_LIMIT = 200;

/** Internal: de-duplicating append. New messages are pushed at the end. */
function appendChat(
  existing: ChatMessage[] | undefined,
  incoming: ChatMessage[],
): ChatMessage[] {
  const base = existing ?? [];
  if (incoming.length === 0) return base;
  const seen = new Set(base.map((m) => m.id));
  const merged = [...base];
  for (const m of incoming) {
    if (!seen.has(m.id)) {
      merged.push(m);
      seen.add(m.id);
    }
  }
  return merged.slice(-CHAT_BUFFER_LIMIT);
}

/** Internal: immutably patch a single message's reactions in place. */
function applyReaction(
  messages: ChatMessage[],
  update: GameChatReactionEvent,
): ChatMessage[] {
  let touched = false;
  const next = messages.map((m) => {
    if (m.id !== update.messageId) return m;
    touched = true;
    const reactions = { ...(m.reactions ?? {}) };
    if (update.emoji === null) {
      delete reactions[update.userId];
    } else {
      reactions[update.userId] = update.emoji;
    }
    return { ...m, reactions };
  });
  return touched ? next : messages;
}

/**
 * Live game subscription. Returns the current `ClientGameState`, a sliding
 * window of recent domain events (for the toast feed) and convenience flags.
 *
 * - Bootstraps from REST so the page can render immediately.
 * - Calls `game:subscribe` on connect (and on reconnect).
 * - Patches the cache on `game:state` / `game:events` / `game:over`.
 */
export function useGameState(id: string | undefined) {
  useGameSocket();
  const qc = useQueryClient();
  const [subscribeError, setSubscribeError] = useState<{
    code: string;
    message: string;
  } | null>(null);

  // REST bootstrap. Stored in a separate key so it doesn't fight the WS-driven
  // live cache during transitions.
  const snapshot = useGameSnapshot(id);

  // Seed the live cache from the snapshot.
  useEffect(() => {
    if (!id || !snapshot.data) return;
    qc.setQueryData<LiveGameQueryData>(GAME_ROOM_KEY(id), (prev) =>
      prev
        ? { ...prev, state: snapshot.data }
        : {
            state: snapshot.data,
            recentEvents: [],
            unseenEvents: [],
            chatMessages: [],
          },
    );
  }, [id, snapshot.data, qc]);

  const live = useQuery<LiveGameQueryData | undefined>({
    queryKey: id ? GAME_ROOM_KEY(id) : [GAMES_QUERY_KEY, 'live', '__missing__'],
    queryFn: () => undefined,
    enabled: !!id,
    staleTime: Infinity,
    initialData: () =>
      snapshot.data
        ? {
            state: snapshot.data,
            recentEvents: [],
            unseenEvents: [],
            chatMessages: [],
          }
        : undefined,
  });

  useEffect(() => {
    if (!id) return;
    const socket = gamesSocket;

    const onState = ({ state }: GameStateEvent) => {
      qc.setQueryData<LiveGameQueryData>(GAME_ROOM_KEY(id), (prev) =>
        prev
          ? { ...prev, state }
          : {
              state,
              recentEvents: [],
              unseenEvents: [],
              chatMessages: [],
            },
      );
    };
    const onEvents = ({ events }: GameEventsEvent) => {
      if (!events.length) return;
      qc.setQueryData<LiveGameQueryData>(GAME_ROOM_KEY(id), (prev) => {
        if (!prev) return prev;
        const recent = [...prev.recentEvents, ...events].slice(
          -RECENT_EVENTS_LIMIT,
        );
        return {
          ...prev,
          recentEvents: recent,
          unseenEvents: [...prev.unseenEvents, ...events],
        };
      });
    };
    const onOver = ({ state, events }: GameOverEvent) => {
      qc.setQueryData<LiveGameQueryData>(GAME_ROOM_KEY(id), (prev) => {
        const baseRecent = prev?.recentEvents ?? [];
        const baseUnseen = prev?.unseenEvents ?? [];
        return {
          state,
          recentEvents: [...baseRecent, ...events].slice(-RECENT_EVENTS_LIMIT),
          unseenEvents: [...baseUnseen, ...events],
          chatMessages: prev?.chatMessages ?? [],
        };
      });
    };
    const onChatMessage = ({ message }: GameChatMessageEvent) => {
      qc.setQueryData<LiveGameQueryData>(GAME_ROOM_KEY(id), (prev) => {
        if (!prev) return prev;
        return { ...prev, chatMessages: appendChat(prev.chatMessages, [message]) };
      });
    };
    const onChatReaction = (update: GameChatReactionEvent) => {
      qc.setQueryData<LiveGameQueryData>(GAME_ROOM_KEY(id), (prev) => {
        if (!prev) return prev;
        return { ...prev, chatMessages: applyReaction(prev.chatMessages, update) };
      });
    };

    socket.on(GAME_EVENTS.state, onState);
    socket.on(GAME_EVENTS.events, onEvents);
    socket.on(GAME_EVENTS.over, onOver);
    socket.on(GAME_EVENTS.chatMessage, onChatMessage);
    socket.on(GAME_EVENTS.chatReaction, onChatReaction);

    let cancelled = false;
    const trySubscribe = () => {
      if (cancelled) return;
      subscribeGame(id)
        .then(({ state, recentEvents, chatHistory }) => {
          qc.setQueryData<LiveGameQueryData>(GAME_ROOM_KEY(id), (prev) => ({
            state,
            recentEvents:
              prev?.recentEvents && prev.recentEvents.length > 0
                ? prev.recentEvents
                : recentEvents,
            unseenEvents: prev?.unseenEvents ?? [],
            // Use the server-side history as canonical: on reconnect it's the
            // best source of truth. Local in-flight messages already in `prev`
            // get re-merged by id de-dup.
            chatMessages: appendChat(chatHistory ?? [], prev?.chatMessages ?? []),
          }));
          setSubscribeError(null);
        })
        .catch((err: unknown) => {
          if (err && typeof err === 'object' && 'code' in err) {
            const code = (err as { code: string }).code;
            const message =
              'message' in err && typeof (err as { message: unknown }).message === 'string'
                ? (err as { message: string }).message
                : code;
            setSubscribeError({ code, message });
          }
        });
    };

    if (socket.connected) {
      trySubscribe();
    } else {
      socket.once('connect', trySubscribe);
    }
    // Re-subscribe on reconnect so a transient drop doesn't leave us stranded.
    socket.on('connect', trySubscribe);

    return () => {
      cancelled = true;
      socket.off(GAME_EVENTS.state, onState);
      socket.off(GAME_EVENTS.events, onEvents);
      socket.off(GAME_EVENTS.over, onOver);
      socket.off(GAME_EVENTS.chatMessage, onChatMessage);
      socket.off(GAME_EVENTS.chatReaction, onChatReaction);
      socket.off('connect', trySubscribe);
    };
  }, [id, qc]);

  /** Drain the unseen-events buffer (call after the UI has consumed them). */
  const acknowledgeEvents = useCallback(
    (count: number) => {
      if (!id || count <= 0) return;
      qc.setQueryData<LiveGameQueryData>(GAME_ROOM_KEY(id), (prev) =>
        prev ? { ...prev, unseenEvents: prev.unseenEvents.slice(count) } : prev,
      );
    },
    [id, qc],
  );

  return {
    data: live.data,
    snapshotError: snapshot.error,
    snapshotPending: snapshot.isPending,
    subscribeError,
    acknowledgeEvents,
  };
}

/**
 * Send a command to the server. Throws a `SocketAckError`-style error on
 * failure (`{ code, message }`); callers should translate via i18n keys.
 */
export function useGameCommand(gameId: string | undefined) {
  return useCallback(
    async (command: GameCommand): Promise<void> => {
      if (!gameId) {
        throw new Error('GAME_ID_MISSING');
      }
      await sendGameCommand(gameId, command);
    },
    [gameId],
  );
}

/** Legacy stub — preserve the old `useGame` signature for non-game callers. */
export function useGame(id: string | undefined) {
  return useGameSnapshot(id);
}

export interface UseGameChatResult {
  messages: ChatMessage[];
  send: (text: string, replyToId?: string) => Promise<void>;
  react: (messageId: string, emoji: string | null) => Promise<void>;
  isSending: boolean;
  unreadCount: number;
  markAllRead: () => void;
  /** Refetch from the server, e.g. on panel-open after a long absence. */
  refresh: () => Promise<void>;
}

/**
 * Chat hook bound to a specific live game. The message list is shared with
 * {@link useGameState} via the same TanStack-Query cache key so a single
 * `game:chat_message` broadcast updates both consumers in one pass.
 *
 * `unreadCount` tracks messages received since the last `markAllRead()` call —
 * the page should call it whenever the panel becomes visible.
 */
export function useGameChat(gameId: string | undefined): UseGameChatResult {
  useGameSocket();
  const qc = useQueryClient();
  const live = useQuery<LiveGameQueryData | undefined>({
    queryKey: gameId
      ? GAME_ROOM_KEY(gameId)
      : [GAMES_QUERY_KEY, 'live', '__chat_missing__'],
    queryFn: () => undefined,
    enabled: !!gameId,
    staleTime: Infinity,
  });
  // Memoised to keep the array reference stable when nothing changed —
  // otherwise the `[messages]` deps below would fire on every render.
  const messages = useMemo<ChatMessage[]>(
    () => live.data?.chatMessages ?? [],
    [live.data?.chatMessages],
  );

  const [isSending, setIsSending] = useState(false);
  // Last message id the UI has acknowledged. Anything past this is "unread".
  // Stored in a ref so toggling read state never causes a render storm.
  const lastReadIdRef = useRef<string | null>(null);
  const [, forceTick] = useState(0);

  // Initialise lastRead on first mount to the *current* tail — so a freshly
  // opened page doesn't render its whole backlog as "unread".
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    if (messages.length === 0) return;
    initRef.current = true;
    lastReadIdRef.current = messages[messages.length - 1]?.id ?? null;
  }, [messages]);

  const unreadCount = (() => {
    if (messages.length === 0) return 0;
    const lastId = lastReadIdRef.current;
    if (!lastId) return messages.length;
    const idx = messages.findIndex((m) => m.id === lastId);
    if (idx === -1) return messages.length;
    return messages.length - 1 - idx;
  })();

  const markAllRead = useCallback(() => {
    if (messages.length === 0) {
      lastReadIdRef.current = null;
    } else {
      lastReadIdRef.current = messages[messages.length - 1]?.id ?? null;
    }
    forceTick((n) => n + 1);
  }, [messages]);

  const send = useCallback(
    async (rawText: string, replyToId?: string): Promise<void> => {
      if (!gameId) throw new Error('GAME_ID_MISSING');
      const text = rawText.trim();
      if (!text) return;
      setIsSending(true);
      try {
        // The broadcast loop will append the canonical message; we don't need
        // to mutate the cache here. Awaiting the ack lets callers surface
        // CHAT_RATE_LIMIT / CHAT_TEXT_INVALID errors.
        await sendChatMessage(gameId, text, replyToId);
      } finally {
        setIsSending(false);
      }
    },
    [gameId],
  );

  const react = useCallback(
    async (messageId: string, emoji: string | null): Promise<void> => {
      if (!gameId) throw new Error('GAME_ID_MISSING');
      // Optimistically patch local state so the chip flips instantly. The
      // server broadcast (which loops back to us too) is the canonical update;
      // applyReaction is idempotent so the round-trip is safe.
      const update = await sendChatReaction(gameId, messageId, emoji);
      qc.setQueryData<LiveGameQueryData>(GAME_ROOM_KEY(gameId), (prev) =>
        prev ? { ...prev, chatMessages: applyReaction(prev.chatMessages, update) } : prev,
      );
    },
    [gameId, qc],
  );

  const refresh = useCallback(async () => {
    if (!gameId) return;
    const { messages: fresh } = await fetchChatHistory(gameId);
    qc.setQueryData<LiveGameQueryData>(GAME_ROOM_KEY(gameId), (prev) =>
      prev ? { ...prev, chatMessages: appendChat(fresh, prev.chatMessages) } : prev,
    );
  }, [gameId, qc]);

  return { messages, send, react, isSending, unreadCount, markAllRead, refresh };
}
