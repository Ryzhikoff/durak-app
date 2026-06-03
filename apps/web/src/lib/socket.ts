/**
 * Socket.IO client bootstrap for the `/lobbies` namespace.
 *
 * The backend authenticates the WS connection via the same HttpOnly session
 * cookie used for REST. Because the cookie is delivered automatically by the
 * browser as soon as `withCredentials: true` is set, the client side has no
 * extra auth work to do.
 *
 * The socket is a module-singleton so multiple consumers (list page, room
 * page, header indicator) share a single connection. `autoConnect: false` lets
 * us only open it when the user enters a screen that actually needs realtime.
 */
import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { LOBBY_NAMESPACE } from '@durak/shared-types';

/**
 * Shared socket instance. Always reuses the same connection across mounts.
 * The `path` defaults to `/socket.io` which nginx proxies to the API.
 */
export const lobbiesSocket: Socket = io(LOBBY_NAMESPACE, {
  withCredentials: true,
  autoConnect: false,
  transports: ['websocket', 'polling'],
});

/** Reference counter so the connection only closes when no one needs it. */
let refCount = 0;

export function connectLobbies(): void {
  refCount += 1;
  if (!lobbiesSocket.connected && !lobbiesSocket.active) {
    lobbiesSocket.connect();
  } else if (!lobbiesSocket.connected) {
    // Active but not yet connected — let it finish, do not double-connect.
    lobbiesSocket.connect();
  }
}

export function disconnectLobbies(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && lobbiesSocket.connected) {
    lobbiesSocket.disconnect();
  }
}

/**
 * Mount-managed lobby socket lifecycle. Components that need realtime updates
 * call this hook once per mount; it bumps a ref counter on connect and only
 * tears down when the last consumer unmounts.
 */
export function useLobbySocket(): Socket {
  useEffect(() => {
    connectLobbies();
    return () => {
      disconnectLobbies();
    };
  }, []);
  return lobbiesSocket;
}

/**
 * Bus for surfacing WS auth failures to whoever cares (typically App.tsx for
 * the global toast + redirect). We keep this as a simple event subscriber so
 * we don't have to thread a router/store reference through the singleton
 * socket — the App layer hooks in once and forwards into the right places.
 *
 * Both the `connect_error` path (handshake middleware rejecting with
 * `Error('UNAUTHORIZED')`) and the legacy `auth:error` event are forwarded as
 * `{ code, message }`.
 */
type AuthErrorListener = (err: { code: string; message: string }) => void;
const authErrorListeners = new Set<AuthErrorListener>();

export function onLobbySocketAuthError(cb: AuthErrorListener): () => void {
  authErrorListeners.add(cb);
  return () => authErrorListeners.delete(cb);
}

function emitAuthError(err: { code: string; message: string }): void {
  for (const cb of authErrorListeners) {
    try {
      cb(err);
    } catch {
      /* listeners are best-effort */
    }
  }
}

lobbiesSocket.on('connect_error', (err: Error) => {
  if (err?.message === 'UNAUTHORIZED') {
    emitAuthError({ code: 'UNAUTHORIZED', message: err.message });
  }
});
lobbiesSocket.on('auth:error', (payload: { code?: string; message?: string }) => {
  emitAuthError({
    code: payload?.code ?? 'UNAUTHORIZED',
    message: payload?.message ?? 'Session expired',
  });
});

/**
 * Server uses `{ ok: true, data } | { error: { code, message, details? } }`
 * as the universal ack envelope (see lobbies.gateway.ts). This helper
 * normalises it into a Promise that rejects with a typed error on the
 * `{ error }` branch — and is defensive enough to also handle the classic
 * socket.io `cb(err, data)` shape in case the server-side contract ever
 * shifts.
 */
export interface SocketError {
  code: string;
  message: string;
  details?: unknown;
}

export class SocketAckError extends Error {
  readonly code: string;
  readonly details: unknown;
  constructor(payload: SocketError) {
    super(payload.message);
    this.code = payload.code;
    this.details = payload.details;
    this.name = 'SocketAckError';
  }
}

type AckEnvelope<T> =
  | { ok: true; data: T }
  | { error: SocketError }
  // Defensive: also accept the classic socket.io `(err, data)` style if it ever
  // surfaces (e.g. a generic middleware wrapping our gateway).
  | T;

export function emitWithAck<T>(
  socket: Socket,
  event: string,
  ...args: unknown[]
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cb = (response: AckEnvelope<T>) => {
      if (response && typeof response === 'object') {
        const obj = response as Record<string, unknown>;
        if ('ok' in obj && obj.ok === true && 'data' in obj) {
          resolve(obj.data as T);
          return;
        }
        if ('error' in obj && obj.error && typeof obj.error === 'object') {
          reject(new SocketAckError(obj.error as SocketError));
          return;
        }
      }
      // Plain payload fallback.
      resolve(response as T);
    };
    socket.emit(event, ...args, cb);
  });
}
