/**
 * Live-game React hooks. Source-of-truth = the WebSocket; the REST snapshot is
 * only used for the initial fetch (so the page can render before the WS
 * handshake completes).
 *
 * The game state lives in TanStack-Query cache so React renders read from a
 * single place. Incoming `game:state`/`game:events`/`game:over` events patch
 * the cache; `useGameCommand` provides the imperative outbound channel.
 */
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GAME_EVENTS } from '@durak/shared-types';
import { fetchGame, listGames } from './api';
import {
  gamesSocket,
  sendGameCommand,
  subscribeGame,
  useGameSocket,
} from './socket';
import type { GameListQuery } from '@durak/shared-types';
import type {
  ClientGameState,
  DomainEvent,
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
        : { state: snapshot.data, recentEvents: [], unseenEvents: [] },
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
          : { state, recentEvents: [], unseenEvents: [] },
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
        };
      });
    };

    socket.on(GAME_EVENTS.state, onState);
    socket.on(GAME_EVENTS.events, onEvents);
    socket.on(GAME_EVENTS.over, onOver);

    let cancelled = false;
    const trySubscribe = () => {
      if (cancelled) return;
      subscribeGame(id)
        .then(({ state, recentEvents }) => {
          qc.setQueryData<LiveGameQueryData>(GAME_ROOM_KEY(id), (prev) => ({
            state,
            recentEvents:
              prev?.recentEvents && prev.recentEvents.length > 0
                ? prev.recentEvents
                : recentEvents,
            unseenEvents: prev?.unseenEvents ?? [],
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
