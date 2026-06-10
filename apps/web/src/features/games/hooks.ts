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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GAME_EVENTS,
  PLAYER_REACTION_BUBBLE_TTL_MS,
  type FaceCardAsset,
  type RematchSession,
  type TextReaction,
} from '@durak/shared-types';
import { fetchFaceCards } from './faceCardsApi';
import {
  TEXT_REACTIONS_QUERY_KEY,
  fetchTextReactions,
} from './textReactionsApi';
import {
  ME_TEXT_REACTIONS_QUERY_KEY,
  createMyTextReaction,
  deleteMyTextReaction,
  fetchMyTextReactions,
} from './userTextReactionsApi';
import { getApiErrorCode } from '@/lib/api';
import {
  acceptRematch,
  cancelRematch,
  fetchGame,
  fetchSameComposition,
  listActiveGames,
  listGames,
  rematch,
  type FetchGameResponse,
} from './api';
import {
  fetchChatHistory,
  gamesSocket,
  sendChatMessage,
  sendChatReaction,
  sendGameCommand,
  sendPauseVote,
  sendPlayerReaction,
  sendPlayerTextReaction,
  subscribeGame,
  useGameSocket,
} from './socket';
import { ME_QUERY_KEY } from '@/features/auth/hooks';
import type {
  CreateUserTextReactionRequest,
  GameDetail,
  GameListQuery,
  UserTextReactionDTO,
} from '@durak/shared-types';
import type {
  ChatMessage,
  ClientGameState,
  DomainEvent,
  GameChatMessageEvent,
  GameChatReactionEvent,
  GameCommand,
  GameConcedeCompletedPayload,
  GameEventsEvent,
  GameOverEvent,
  GamePausedPayload,
  GamePauseVoteStartedPayload,
  GamePauseVoteUpdatePayload,
  GamePauseWaitExtendedPayload,
  GameStateEvent,
  PauseInfo,
  PauseVote,
  PlayerReactionPayload,
  PlayerTextReactionPayload,
  TurnTimerEvent,
  TurnTimerState,
} from './types';

export const GAMES_QUERY_KEY = 'games' as const;
export const ACTIVE_GAMES_QUERY_KEY = 'active-games' as const;
/** TanStack Query key for the global face-card asset map (12 slots). */
export const FACE_CARDS_QUERY_KEY = ['face-cards'] as const;

/**
 * Face-card asset map shared by every PlayingCard renderer. Returns the
 * uploaded URL for J/Q/K slots (when present) so the renderer overrides the
 * default SVG silhouette. Cached aggressively — admins update this rarely,
 * and the admin mutation explicitly invalidates the key.
 */
export function useFaceCardAssets() {
  return useQuery<FaceCardAsset[]>({
    queryKey: FACE_CARDS_QUERY_KEY,
    queryFn: fetchFaceCards,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    // Backend table may be absent (migration not yet deployed) — failing
    // silently is the safer default; PlayingCard falls back to its SVG.
    retry: false,
  });
}
/** TanStack Query key for the active rematch session (single per logged-in user). */
export const REMATCH_SESSION_QUERY_KEY = ['rematch', 'session'] as const;

/** Legacy: list of games stub (Phase 5 returns empty). Kept for forward-compat. */
export function useGames(query: GameListQuery) {
  return useQuery({
    queryKey: [GAMES_QUERY_KEY, query],
    queryFn: () => listGames(query),
    staleTime: 15_000,
  });
}

/**
 * List of currently-active games (any user can watch). Polls every 10s so a
 * newly-started or just-finished game appears / disappears without the user
 * having to refresh. The `game:over_public` listener on RatingPage also
 * invalidates this query so finished games drop out promptly.
 */
export function useActiveGames() {
  return useQuery({
    queryKey: [ACTIVE_GAMES_QUERY_KEY],
    queryFn: () => listActiveGames(),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}

/**
 * Phase 7B — REST bootstrap fetch. Returns the discriminated payload so the
 * page can decide whether to render the live UI or the finished-game view.
 */
export function useGameSnapshot(id: string | undefined) {
  return useQuery<FetchGameResponse>({
    queryKey: [GAMES_QUERY_KEY, 'detail', id],
    queryFn: () => fetchGame(id as string),
    enabled: !!id,
    retry: false,
    staleTime: 5_000,
  });
}

/**
 * Phase 7B — past finished games played by the exact same set of participants.
 * Backed by `GET /games/:id/same-composition`. Errors propagate as TanStack
 * query state — typically 404 GAME_NOT_FOUND when the reference game isn't
 * finished yet (active games / unknown ids).
 */
export function useSameComposition(id: string | undefined, limit?: number) {
  return useQuery({
    queryKey: [GAMES_QUERY_KEY, 'same-composition', id, limit ?? null],
    queryFn: () => fetchSameComposition(id as string, limit),
    enabled: !!id,
    retry: false,
    staleTime: 30_000,
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
  /** Phase 8 — current disconnect-pause state. Null when not paused. */
  pauseInfo: PauseInfo | null;
  /** Phase 9 — current turn-timer snapshot. Null when no countdown is active. */
  turnTimer: TurnTimerState | null;
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

export interface UseGameStateOptions {
  /**
   * When `false`, the hook short-circuits all WS work — no `game:subscribe`
   * round-trip, no event listeners attached. The live cache is still read so
   * any data seeded previously remains visible, but no new subscription is
   * initiated. Useful for finished games where the REST snapshot is final and
   * the WS would otherwise reject with `GAME_NOT_FOUND`/`GAME_FINISHED`.
   *
   * Defaults to `true` for backwards compatibility.
   */
  enabled?: boolean;
}

/**
 * Live game subscription. Returns the current `ClientGameState`, a sliding
 * window of recent domain events (for the toast feed) and convenience flags.
 *
 * - Bootstraps from REST so the page can render immediately.
 * - Calls `game:subscribe` on connect (and on reconnect).
 * - Patches the cache on `game:state` / `game:events` / `game:over`.
 */
export function useGameState(
  id: string | undefined,
  options: UseGameStateOptions = {},
) {
  const { enabled = true } = options;
  useGameSocket();
  const qc = useQueryClient();
  const [subscribeError, setSubscribeError] = useState<{
    code: string;
    message: string;
  } | null>(null);

  // REST bootstrap. Stored in a separate key so it doesn't fight the WS-driven
  // live cache during transitions.
  const snapshot = useGameSnapshot(id);
  // Only the live branch of the discriminated REST payload seeds the live
  // cache. The finished branch is consumed by `<GameDetailView>` directly.
  const liveSnapshot =
    snapshot.data?.kind === 'live' ? snapshot.data.state : null;
  // Phase 8 — the REST snapshot now also carries the pause meta-state so the
  // overlay renders BEFORE the WS subscribe ack lands. Null when no pause is
  // currently active for this game.
  const snapshotPauseInfo =
    snapshot.data?.kind === 'live' ? (snapshot.data.pauseInfo ?? null) : null;
  // Phase 9 — same idea for the turn-timer snapshot. Seeded from REST so the
  // countdown renders immediately; WS `game:turn_timer` events take over the
  // moment the subscription is live.
  const snapshotTurnTimer =
    snapshot.data?.kind === 'live' ? (snapshot.data.turnTimer ?? null) : null;

  // Seed the live cache from the snapshot.
  useEffect(() => {
    if (!id || !liveSnapshot || !enabled) return;
    qc.setQueryData<LiveGameQueryData>(GAME_ROOM_KEY(id), (prev) =>
      prev
        ? {
            ...prev,
            state: liveSnapshot,
            pauseInfo: prev.pauseInfo ?? snapshotPauseInfo,
            turnTimer: prev.turnTimer ?? snapshotTurnTimer,
          }
        : {
            state: liveSnapshot,
            recentEvents: [],
            unseenEvents: [],
            chatMessages: [],
            pauseInfo: snapshotPauseInfo,
            turnTimer: snapshotTurnTimer,
          },
    );
  }, [id, liveSnapshot, snapshotPauseInfo, snapshotTurnTimer, qc, enabled]);

  const live = useQuery<LiveGameQueryData | undefined>({
    queryKey: id ? GAME_ROOM_KEY(id) : [GAMES_QUERY_KEY, 'live', '__missing__'],
    queryFn: () => undefined,
    enabled: !!id && enabled,
    staleTime: Infinity,
    initialData: () =>
      liveSnapshot && enabled
        ? {
            state: liveSnapshot,
            recentEvents: [],
            unseenEvents: [],
            chatMessages: [],
            pauseInfo: snapshotPauseInfo,
            turnTimer: snapshotTurnTimer,
          }
        : undefined,
  });

  useEffect(() => {
    if (!id || !enabled) return;
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
              pauseInfo: null,
              turnTimer: null,
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
          // A game ending erases any pending pause overlay — the result modal
          // is now the source of truth.
          pauseInfo: null,
          // Game-over also kills any in-flight turn-timer so the countdown
          // doesn't keep ticking under the modal.
          turnTimer: null,
        };
      });
      // Backend has just dropped `userInGame:<userId>`, so the "active game"
      // banner in AppShell needs to re-evaluate. Refetching /auth/me clears
      // the user's `currentGameId` without requiring an F5.
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    };
    const onTurnTimer = ({ state: ttState }: TurnTimerEvent) => {
      qc.setQueryData<LiveGameQueryData>(GAME_ROOM_KEY(id), (prev) =>
        prev ? { ...prev, turnTimer: ttState ?? null } : prev,
      );
    };
    const onPaused = (payload: GamePausedPayload) => {
      qc.setQueryData<LiveGameQueryData>(GAME_ROOM_KEY(id), (prev) => {
        if (!prev) return prev;
        // A paused event always re-establishes the disconnected set, even if
        // a previous pause was already tracked — the server is the source of
        // truth here.
        const next: PauseInfo = {
          disconnectedUserIds: payload.disconnectedUserIds,
          pausedAt: payload.pausedAt,
          timeoutAt: payload.timeoutAt,
          voteOpen: prev.pauseInfo?.voteOpen ?? false,
          voteOpenedAt: prev.pauseInfo?.voteOpenedAt ?? null,
          votes: prev.pauseInfo?.votes ?? {},
        };
        return { ...prev, pauseInfo: next };
      });
    };
    const onResumed = () => {
      qc.setQueryData<LiveGameQueryData>(GAME_ROOM_KEY(id), (prev) =>
        prev ? { ...prev, pauseInfo: null } : prev,
      );
    };
    const onVoteStarted = (payload: GamePauseVoteStartedPayload) => {
      qc.setQueryData<LiveGameQueryData>(GAME_ROOM_KEY(id), (prev) => {
        if (!prev) return prev;
        // Open the vote window. timeoutAt drives the on-screen countdown for
        // the voting phase itself — server resets it to "now + grace" before
        // emitting this event.
        const nowIso = new Date().toISOString();
        const next: PauseInfo = {
          disconnectedUserIds: payload.disconnectedUserIds,
          pausedAt: prev.pauseInfo?.pausedAt ?? nowIso,
          timeoutAt:
            prev.pauseInfo?.timeoutAt ??
            new Date(Date.now() + payload.timeoutSec * 1000).toISOString(),
          voteOpen: true,
          voteOpenedAt: nowIso,
          votes: {},
        };
        return { ...prev, pauseInfo: next };
      });
    };
    const onVoteUpdate = (payload: GamePauseVoteUpdatePayload) => {
      qc.setQueryData<LiveGameQueryData>(GAME_ROOM_KEY(id), (prev) => {
        if (!prev?.pauseInfo) return prev;
        return {
          ...prev,
          pauseInfo: { ...prev.pauseInfo, votes: payload.votes },
        };
      });
    };
    const onWaitExtended = (payload: GamePauseWaitExtendedPayload) => {
      qc.setQueryData<LiveGameQueryData>(GAME_ROOM_KEY(id), (prev) => {
        if (!prev?.pauseInfo) return prev;
        return {
          ...prev,
          pauseInfo: {
            ...prev.pauseInfo,
            voteOpen: false,
            voteOpenedAt: null,
            votes: {},
            pausedAt: new Date().toISOString(),
            timeoutAt: payload.timeoutAt,
          },
        };
      });
    };
    const onConcedeCompleted = (_payload: GameConcedeCompletedPayload) => {
      // The game-over broadcast that follows will handle the actual state
      // transition. We just drop the overlay so the user is never left
      // staring at it while the game-over modal opens behind.
      qc.setQueryData<LiveGameQueryData>(GAME_ROOM_KEY(id), (prev) =>
        prev ? { ...prev, pauseInfo: null } : prev,
      );
      void _payload;
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
    socket.on(GAME_EVENTS.paused, onPaused);
    socket.on(GAME_EVENTS.resumed, onResumed);
    socket.on(GAME_EVENTS.pauseVoteStarted, onVoteStarted);
    socket.on(GAME_EVENTS.pauseVoteUpdate, onVoteUpdate);
    socket.on(GAME_EVENTS.pauseWaitExtended, onWaitExtended);
    socket.on(GAME_EVENTS.concedeCompleted, onConcedeCompleted);
    socket.on(GAME_EVENTS.turnTimer, onTurnTimer);

    let cancelled = false;
    const trySubscribe = () => {
      if (cancelled) return;
      subscribeGame(id)
        .then(({ state, recentEvents, chatHistory, pauseInfo, turnTimer }) => {
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
            // Server-supplied pause state wins on resubscribe. Null clears
            // any stale local overlay (e.g. when we missed the resume event
            // during a network blip).
            pauseInfo: pauseInfo ?? null,
            // Same idea for the turn-timer snapshot — the server-side
            // deadline is the authoritative source on reconnect.
            turnTimer: turnTimer ?? null,
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
      socket.off(GAME_EVENTS.paused, onPaused);
      socket.off(GAME_EVENTS.resumed, onResumed);
      socket.off(GAME_EVENTS.pauseVoteStarted, onVoteStarted);
      socket.off(GAME_EVENTS.pauseVoteUpdate, onVoteUpdate);
      socket.off(GAME_EVENTS.pauseWaitExtended, onWaitExtended);
      socket.off(GAME_EVENTS.concedeCompleted, onConcedeCompleted);
      socket.off(GAME_EVENTS.turnTimer, onTurnTimer);
      socket.off('connect', trySubscribe);
    };
  }, [id, qc, enabled]);

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

/**
 * Phase 7B — discriminated game-page hook. Combines the REST bootstrap (so the
 * page knows live vs finished) with the live WS subscription (`useGameState`)
 * so callers can render the right view via a single switch over `kind`.
 *
 * - `loading` while the bootstrap is in flight.
 * - `not_found` on 404 GAME_NOT_FOUND.
 * - `error` for everything else.
 * - `live` while the REST + WS pipeline is feeding fresh state.
 * - `finished` for finished-game public detail.
 */
export type UseGameResult =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'error'; error: unknown }
  | {
      kind: 'live';
      state: ClientGameState;
      unseenEvents: DomainEvent[];
      acknowledgeEvents: (count: number) => void;
      subscribeError: { code: string; message: string } | null;
      pauseInfo: PauseInfo | null;
      turnTimer: TurnTimerState | null;
    }
  | { kind: 'finished'; detail: GameDetail };

export function useGame(id: string | undefined): UseGameResult {
  // Both calls are unconditional so the rules-of-hooks invariant holds.
  // `useGameSnapshot` is memoised by id; calling it from both `useGameState`
  // and here yields the same cached result.
  const snapshot = useGameSnapshot(id);
  // Once the REST snapshot tells us the game is finished there is no live
  // state to subscribe to — gate the WS work explicitly to avoid the wasted
  // `game:subscribe` round-trip (and the `GAME_NOT_FOUND`/`GAME_FINISHED`
  // ack it would receive).
  const subscribeEnabled = snapshot.data?.kind !== 'finished';
  const live = useGameState(id, { enabled: subscribeEnabled });
  if (!id) {
    return { kind: 'loading' };
  }
  // Finished games short-circuit on the REST snapshot — no WS work to wait on.
  if (snapshot.data?.kind === 'finished') {
    return { kind: 'finished', detail: snapshot.data.detail };
  }
  // Live data wins as soon as it shows up — the live cache is the canonical
  // source while the WS is connected.
  if (live.data) {
    return {
      kind: 'live',
      state: live.data.state,
      unseenEvents: live.data.unseenEvents,
      acknowledgeEvents: live.acknowledgeEvents,
      subscribeError: live.subscribeError,
      pauseInfo: live.data.pauseInfo,
      turnTimer: live.data.turnTimer,
    };
  }
  if (snapshot.isPending) {
    return { kind: 'loading' };
  }
  if (snapshot.error) {
    const code = getApiErrorCode(snapshot.error);
    if (code === 'GAME_NOT_FOUND') return { kind: 'not_found' };
    return { kind: 'error', error: snapshot.error };
  }
  // Snapshot resolved live but the live cache hasn't been seeded yet — show
  // a brief loading while the effect fires.
  return { kind: 'loading' };
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
 * the page should call it whenever the panel becomes visible. Own messages
 * count too: a send from a second device (or even the same device while the
 * panel is closed) bumps the badge so the user is never silently behind.
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

export interface UsePauseVoteResult {
  /** Pause meta-state read from the live cache. Null while not paused. */
  pauseInfo: PauseInfo | null;
  /** Vote already cast by the current viewer, if any. */
  myVote: PauseVote | null;
  /** Cast a vote. Throws a SocketAckError-style error on rejection. */
  vote: (choice: PauseVote) => Promise<void>;
  /** True while the most recent vote is awaiting the server ack. */
  isSubmitting: boolean;
}

/**
 * Hook bound to a specific live game's pause state. Reads `pauseInfo` from
 * the shared TanStack-Query cache (same key as {@link useGameState}) and
 * exposes a `vote()` helper that forwards to the WS gateway.
 *
 * Designed for the overlay component — does NOT trigger its own subscription
 * (the parent's `useGameState` already keeps the cache fresh).
 */
export function usePauseVote(
  gameId: string | undefined,
  myUserId: string | undefined,
): UsePauseVoteResult {
  const live = useQuery<LiveGameQueryData | undefined>({
    queryKey: gameId
      ? GAME_ROOM_KEY(gameId)
      : [GAMES_QUERY_KEY, 'live', '__pause_missing__'],
    queryFn: () => undefined,
    enabled: !!gameId,
    staleTime: Infinity,
  });
  const pauseInfo = live.data?.pauseInfo ?? null;
  const myVote: PauseVote | null =
    myUserId && pauseInfo?.votes[myUserId] ? pauseInfo.votes[myUserId] : null;
  const [isSubmitting, setIsSubmitting] = useState(false);

  const vote = useCallback(
    async (choice: PauseVote): Promise<void> => {
      if (!gameId) throw new Error('GAME_ID_MISSING');
      setIsSubmitting(true);
      try {
        await sendPauseVote(gameId, choice);
      } finally {
        setIsSubmitting(false);
      }
    },
    [gameId],
  );

  return { pauseInfo, myVote, vote, isSubmitting };
}

/**
 * Reactive read of the live turn-timer snapshot from the shared TanStack-Query
 * cache. Returns the {@link TurnTimerState} (or `null` when no countdown is
 * active). The hook does NOT manage its own subscription — `useGameState` is
 * already pumping updates into the same cache key.
 *
 * Designed to be cheap enough to call from each renderer that wants to display
 * a countdown (seat chip, hand badge, info strip). The downstream
 * {@link TurnTimer} component re-renders every second from a local
 * `setInterval`, so the parent only re-renders when the underlying snapshot
 * changes (active player flipped, timer cleared, new deadline armed).
 */
export function useTurnTimer(gameId: string | undefined): TurnTimerState | null {
  const live = useQuery<LiveGameQueryData | undefined>({
    queryKey: gameId
      ? GAME_ROOM_KEY(gameId)
      : [GAMES_QUERY_KEY, 'live', '__turn_timer_missing__'],
    queryFn: () => undefined,
    enabled: !!gameId,
    staleTime: Infinity,
  });
  return live.data?.turnTimer ?? null;
}

/** Per-seat live reaction state — what to render above each user's seat. */
export interface ActiveReaction {
  emoji: string;
  /** ISO timestamp returned by the server — drives the React `key` for replays. */
  timestamp: string;
}

export interface UseGameReactionsResult {
  /** Current floating reaction per user. Missing entry = nothing to show. */
  reactions: Record<string, ActiveReaction>;
  /** Fire one's own reaction. Throws SocketAckError-style on rate-limit. */
  send: (emoji: string) => Promise<void>;
}

/**
 * Live seat-reaction subscription. Listens for `game:player_reaction` and keeps
 * a `userId -> { emoji, timestamp }` snapshot of what's currently floating. An
 * entry is auto-cleared after {@link PLAYER_REACTION_BUBBLE_TTL_MS}; sending a
 * fresh reaction overrides the previous one for the same user immediately.
 *
 * The store lives in component state (not the TanStack cache) because the data
 * is purely ephemeral — there's no other consumer and nothing to persist.
 */
export function useGameReactions(
  gameId: string | undefined,
): UseGameReactionsResult {
  useGameSocket();
  const [reactions, setReactions] = useState<Record<string, ActiveReaction>>({});
  // Track per-user expiry timers so a new reaction cancels the previous fade.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!gameId) return;
    const socket = gamesSocket;
    // Capture the ref's `current` into a local for the cleanup — the linter
    // (rightfully) complains that `timersRef.current` could have changed by the
    // time the cleanup fires. The Map itself is the long-lived object we want
    // to drain, so capturing once on mount is exactly the right thing.
    const timers = timersRef.current;

    const onReaction = (payload: PlayerReactionPayload) => {
      const { userId, emoji, timestamp } = payload;
      // Reset any pending expiry for this seat so the new bubble runs the full
      // animation cycle.
      const prev = timers.get(userId);
      if (prev) clearTimeout(prev);
      setReactions((cur) => ({ ...cur, [userId]: { emoji, timestamp } }));
      const handle = setTimeout(() => {
        timers.delete(userId);
        setReactions((cur) => {
          // Only drop the entry if the timestamp is still the one we scheduled
          // for — protects against a races where a newer reaction arrived
          // before the timer cleanup ran but after `clearTimeout` failed (very
          // unlikely in practice, this is just defensive).
          if (cur[userId]?.timestamp !== timestamp) return cur;
          const next = { ...cur };
          delete next[userId];
          return next;
        });
      }, PLAYER_REACTION_BUBBLE_TTL_MS);
      timers.set(userId, handle);
    };

    socket.on(GAME_EVENTS.playerReaction, onReaction);
    return () => {
      socket.off(GAME_EVENTS.playerReaction, onReaction);
      // Drain pending timers on unmount so we don't leak.
      for (const handle of timers.values()) clearTimeout(handle);
      timers.clear();
    };
  }, [gameId]);

  const send = useCallback(
    async (emoji: string): Promise<void> => {
      if (!gameId) throw new Error('GAME_ID_MISSING');
      await sendPlayerReaction(gameId, emoji);
    },
    [gameId],
  );

  return { reactions, send };
}

/**
 * Public picker list — admin-managed text phrases that players can fire as a
 * floating bubble. Cached aggressively (5 min) since admin edits are rare and
 * the admin mutation explicitly invalidates the key.
 */
export function useTextReactions() {
  return useQuery<TextReaction[]>({
    queryKey: TEXT_REACTIONS_QUERY_KEY,
    queryFn: fetchTextReactions,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    // The endpoint is unconditional but the table may be empty / the migration
    // may not yet be deployed — fail-fast so callers can render an empty UI
    // instead of a perpetual spinner.
    retry: false,
  });
}

/**
 * Owner-scoped picker list — per-user custom phrases the current user has
 * saved. Used both by the in-game picker (merged with the admin globals) and
 * by the profile page where the user manages the list.
 *
 * The cache key is independent of the global list so admin mutations don't
 * invalidate the user list and vice-versa; the mutations below explicitly
 * invalidate `ME_TEXT_REACTIONS_QUERY_KEY` so the picker re-fetches after a
 * profile-side add / delete without the user opening it twice.
 */
export function useMyTextReactions() {
  return useQuery<UserTextReactionDTO[]>({
    queryKey: ME_TEXT_REACTIONS_QUERY_KEY,
    queryFn: fetchMyTextReactions,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });
}

/**
 * Add a new custom phrase to the current user's list. The server enforces
 * trim + length + per-user cap; callers should surface the error code
 * (`USER_TEXT_REACTION_LIMIT_REACHED`, `TEXT_REACTION_EMPTY`,
 * `TEXT_REACTION_TOO_LONG`) via i18n.
 */
export function useCreateMyTextReaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserTextReactionRequest) => createMyTextReaction(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ME_TEXT_REACTIONS_QUERY_KEY });
    },
  });
}

/** Remove a custom phrase. */
export function useDeleteMyTextReaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteMyTextReaction(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ME_TEXT_REACTIONS_QUERY_KEY });
    },
  });
}

/** Per-seat live TEXT reaction state. Twin of {@link ActiveReaction}. */
export interface ActiveTextReaction {
  text: string;
  /** ISO timestamp returned by the server — drives the React `key` for replays. */
  timestamp: string;
}

export interface UseGameTextReactionsResult {
  /** Current floating text reaction per user. Missing entry = nothing to show. */
  textReactions: Record<string, ActiveTextReaction>;
  /** Fire a text reaction by its admin-managed row id. */
  send: (textReactionId: string) => Promise<void>;
}

/**
 * Live seat TEXT-reaction subscription — sibling of {@link useGameReactions}.
 * Mirrors its TTL bookkeeping (per-user expiry timers) but in a separate state
 * slot so an emoji bubble and a text bubble can coexist for the same user.
 */
export function useGameTextReactions(
  gameId: string | undefined,
): UseGameTextReactionsResult {
  useGameSocket();
  const [textReactions, setTextReactions] = useState<
    Record<string, ActiveTextReaction>
  >({});
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!gameId) return;
    const socket = gamesSocket;
    const timers = timersRef.current;

    const onReaction = (payload: PlayerTextReactionPayload) => {
      const { userId, text, timestamp } = payload;
      const prev = timers.get(userId);
      if (prev) clearTimeout(prev);
      setTextReactions((cur) => ({ ...cur, [userId]: { text, timestamp } }));
      const handle = setTimeout(() => {
        timers.delete(userId);
        setTextReactions((cur) => {
          if (cur[userId]?.timestamp !== timestamp) return cur;
          const next = { ...cur };
          delete next[userId];
          return next;
        });
      }, PLAYER_REACTION_BUBBLE_TTL_MS);
      timers.set(userId, handle);
    };

    socket.on(GAME_EVENTS.playerTextReaction, onReaction);
    return () => {
      socket.off(GAME_EVENTS.playerTextReaction, onReaction);
      for (const handle of timers.values()) clearTimeout(handle);
      timers.clear();
    };
  }, [gameId]);

  const send = useCallback(
    async (textReactionId: string): Promise<void> => {
      if (!gameId) throw new Error('GAME_ID_MISSING');
      await sendPlayerTextReaction(gameId, textReactionId);
    },
    [gameId],
  );

  return { textReactions, send };
}

/**
 * Initiate (or idempotent accept) a rematch session. On success the response
 * carries the freshly-updated {@link RematchSession}; the hook also seeds it
 * into TanStack-Query cache under {@link REMATCH_SESSION_QUERY_KEY} so the
 * floating modal can render straight away without waiting for the WS broadcast.
 *
 * Server-side errors that the UI translates via i18n:
 *  - `NOT_A_PARTICIPANT` (403): caller wasn't in the source game.
 *  - `REMATCH_WINDOW_CLOSED` (400): too long since the source game ended.
 *  - `REMATCH_NOT_FOUND` (404): session is gone (cancelled / expired).
 *  - `REMATCH_EXPIRED` (410): server-side TTL fired between read and lock.
 */
export function useRematch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (gameId: string) => rematch(gameId),
    onSuccess: ({ session }) => {
      qc.setQueryData<RematchSession | null>(REMATCH_SESSION_QUERY_KEY, session);
    },
  });
}

/** Accept an in-flight rematch session. */
export function useAcceptRematch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sourceGameId: string) => acceptRematch(sourceGameId),
    onSuccess: ({ session }) => {
      qc.setQueryData<RematchSession | null>(REMATCH_SESSION_QUERY_KEY, session);
    },
  });
}

/** Cancel an in-flight rematch session (initiator / invitee). */
export function useCancelRematch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sourceGameId: string) => cancelRematch(sourceGameId),
    onSuccess: () => {
      qc.setQueryData<RematchSession | null>(REMATCH_SESSION_QUERY_KEY, null);
    },
  });
}

/**
 * Reads the live rematch session out of the cache. Populated by:
 *  - {@link useRematch} success handler (initiator path),
 *  - the global {@link useRematchSocket} listener (`rematch:invited` /
 *    `rematch:updated`).
 * Cleared by `rematch:started` / `rematch:cancelled` and by
 * {@link useCancelRematch}.
 */
export function useRematchSession(): RematchSession | null {
  const query = useQuery<RematchSession | null>({
    queryKey: REMATCH_SESSION_QUERY_KEY,
    queryFn: () => null,
    staleTime: Infinity,
    initialData: null,
  });
  return query.data ?? null;
}
