/**
 * TanStack-Query backed hooks for the lobby feature. We use the query cache as
 * the source of truth and let WS events patch it via `setQueryData`. This way
 * the components read straight from `useQuery` without any local state plumbing.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  LOBBY_EVENTS,
  type Lobby,
  type LobbySettings,
  type LobbySummary,
} from '@durak/shared-types';
import { createLobby, fetchLobby, leaveCurrentLobby, listLobbies } from './api';
import {
  joinLobby,
  leaveLobby,
  setLobbyReady,
  startLobby,
  subscribeLobbies,
  unsubscribeLobbies,
  updateLobbySettings,
} from './socket';
import { lobbiesSocket, useLobbySocket } from '@/lib/socket';

export const LOBBY_LIST_KEY = ['lobbies', 'list'] as const;
export const LOBBY_ROOM_KEY = (id: string) =>
  ['lobbies', 'room', id] as const;

/**
 * Open lobbies, live-updated. Bootstraps from REST (instant render even before
 * WS connects) then merges WS deltas into the same cache key.
 */
export function useLobbyList() {
  useLobbySocket();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: LOBBY_LIST_KEY,
    queryFn: listLobbies,
    staleTime: 10_000,
  });

  useEffect(() => {
    const socket = lobbiesSocket;

    const onSnapshot = ({ items }: { items: LobbySummary[] }) => {
      qc.setQueryData(LOBBY_LIST_KEY, items);
    };
    const onAdded = ({ lobby }: { lobby: LobbySummary }) => {
      qc.setQueryData<LobbySummary[]>(LOBBY_LIST_KEY, (prev) => {
        const next = (prev ?? []).filter((l) => l.id !== lobby.id);
        next.unshift(lobby);
        return next;
      });
    };
    const onUpdated = ({ lobby }: { lobby: LobbySummary }) => {
      qc.setQueryData<LobbySummary[]>(LOBBY_LIST_KEY, (prev) =>
        (prev ?? []).map((l) => (l.id === lobby.id ? lobby : l)),
      );
    };
    const onRemoved = ({ lobbyId }: { lobbyId: string }) => {
      qc.setQueryData<LobbySummary[]>(LOBBY_LIST_KEY, (prev) =>
        (prev ?? []).filter((l) => l.id !== lobbyId),
      );
    };

    socket.on(LOBBY_EVENTS.list, onSnapshot);
    socket.on(LOBBY_EVENTS.added, onAdded);
    socket.on(LOBBY_EVENTS.updated, onUpdated);
    socket.on(LOBBY_EVENTS.removed, onRemoved);

    let cancelled = false;
    const trySubscribe = () => {
      if (cancelled) return;
      subscribeLobbies().catch(() => undefined);
    };

    if (socket.connected) {
      trySubscribe();
    } else {
      socket.once('connect', trySubscribe);
    }

    return () => {
      cancelled = true;
      socket.off(LOBBY_EVENTS.list, onSnapshot);
      socket.off(LOBBY_EVENTS.added, onAdded);
      socket.off(LOBBY_EVENTS.updated, onUpdated);
      socket.off(LOBBY_EVENTS.removed, onRemoved);
      socket.off('connect', trySubscribe);
      // Server treats unsubscribe as best-effort; ignore errors / disconnected.
      if (socket.connected) {
        unsubscribeLobbies().catch(() => undefined);
      }
    };
  }, [qc]);

  return query;
}

/** Strongly typed payload emitted by the server on lobby:state. */
interface LobbyStateEvent {
  lobby: Lobby;
}
interface LobbyStartedEvent {
  gameId: string;
}
interface LobbyDeletedEvent {
  lobbyId: string;
}

interface UseLobbyRoomOptions {
  onStarted?: (gameId: string) => void;
  onDeleted?: () => void;
}

/**
 * Lobby-room state + lifecycle. On mount: fetches the snapshot, auto-joins via
 * WS, subscribes to `lobby:state` for live updates. Does NOT auto-leave on
 * unmount (intentional — see gateway.handleDisconnect doc).
 */
export function useLobbyRoom(id: string | undefined, opts: UseLobbyRoomOptions = {}) {
  useLobbySocket();
  const qc = useQueryClient();
  const [joinError, setJoinError] = useState<{ code: string; message: string } | null>(null);

  const query = useQuery({
    queryKey: id ? LOBBY_ROOM_KEY(id) : ['lobbies', 'room', '__missing__'],
    queryFn: () => fetchLobby(id!),
    enabled: !!id,
    staleTime: 5_000,
  });

  const { onStarted, onDeleted } = opts;

  useEffect(() => {
    if (!id) return;
    const socket = lobbiesSocket;

    const onState = ({ lobby }: LobbyStateEvent) => {
      qc.setQueryData(LOBBY_ROOM_KEY(id), lobby);
    };
    const onStartedEvt = ({ gameId }: LobbyStartedEvent) => {
      onStarted?.(gameId);
    };
    const onDeletedEvt = ({ lobbyId }: LobbyDeletedEvent) => {
      if (lobbyId === id) onDeleted?.();
    };

    socket.on(LOBBY_EVENTS.state, onState);
    socket.on(LOBBY_EVENTS.started, onStartedEvt);
    socket.on(LOBBY_EVENTS.deleted, onDeletedEvt);

    let cancelled = false;
    const tryJoin = () => {
      if (cancelled) return;
      joinLobby(id)
        .then(({ lobby }) => {
          qc.setQueryData(LOBBY_ROOM_KEY(id), lobby);
          setJoinError(null);
        })
        .catch((err: unknown) => {
          // ALREADY_IN_LOBBY for the *same* lobby is the happy path on rejoin —
          // server will still emit `lobby:state`. For any other error code, surface it.
          if (err && typeof err === 'object' && 'code' in err) {
            const code = (err as { code: string }).code;
            const message =
              'message' in err && typeof (err as { message: unknown }).message === 'string'
                ? (err as { message: string }).message
                : code;
            if (code !== 'ALREADY_IN_LOBBY') {
              setJoinError({ code, message });
            }
          }
        });
    };

    if (socket.connected) {
      tryJoin();
    } else {
      socket.once('connect', tryJoin);
    }

    return () => {
      cancelled = true;
      socket.off(LOBBY_EVENTS.state, onState);
      socket.off(LOBBY_EVENTS.started, onStartedEvt);
      socket.off(LOBBY_EVENTS.deleted, onDeletedEvt);
      socket.off('connect', tryJoin);
    };
  }, [id, qc, onStarted, onDeleted]);

  return { ...query, joinError };
}

export function useCreateLobby() {
  return useMutation({
    mutationFn: (settings?: Partial<LobbySettings>) => createLobby(settings),
  });
}

export function useLeaveLobby() {
  return useMutation({
    mutationFn: (lobbyId: string) => leaveLobby(lobbyId),
  });
}

/**
 * REST escape hatch for "I'm stuck in a lobby, get me out". Used from the
 * create-lobby modal when the user hits ALREADY_IN_LOBBY but their WS is
 * disconnected or referencing a stale lobby.
 */
export function useLeaveCurrentLobbyRest() {
  return useMutation({
    mutationFn: () => leaveCurrentLobby(),
  });
}

export function useUpdateLobbySettings() {
  return useMutation({
    mutationFn: ({
      lobbyId,
      settings,
    }: {
      lobbyId: string;
      settings: Partial<LobbySettings>;
    }) => updateLobbySettings(lobbyId, settings),
  });
}

export function useSetReady() {
  return useMutation({
    mutationFn: ({ lobbyId, ready }: { lobbyId: string; ready: boolean }) =>
      setLobbyReady(lobbyId, ready),
  });
}

export function useStartLobby() {
  return useMutation({
    mutationFn: (lobbyId: string) => startLobby(lobbyId),
  });
}

/**
 * Generic debouncer for the in-room settings editor. We want immediate UI
 * response on radio/toggle changes but a small delay on number inputs so a
 * user typing "10" doesn't fire two `update_settings` calls (1, then 10) and
 * lose the trailing keystroke to a race with the broadcast.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/** Convenience: returns the lobby a user is currently in (from list cache). */
export function useCurrentLobbyId(userId: string | undefined): string | null {
  const list = useQuery<LobbySummary[]>({
    queryKey: LOBBY_LIST_KEY,
    queryFn: listLobbies,
    enabled: !!userId,
    staleTime: 10_000,
  });
  return useMemo(() => {
    if (!userId || !list.data) return null;
    const found = list.data.find((l) =>
      l.players.some((p) => p.userId === userId),
    );
    return found?.id ?? null;
  }, [userId, list.data]);
}
