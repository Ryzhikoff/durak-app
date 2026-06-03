import { Logger, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import {
  LOBBY_EVENTS,
  LOBBY_NAMESPACE,
  type Lobby,
  type LobbySettings,
  type LobbySummary,
} from '@durak/shared-types';
import { SESSION_COOKIE_NAME } from '../auth/auth.constants';
import { SessionService } from '../auth/session.service';
import { LobbiesService, lobbySummary } from './lobbies.service';

interface AckErr {
  error: { code: string; message: string; details?: unknown };
}
interface AckOk<T> {
  ok: true;
  data: T;
}

type Ack<T> = AckErr | AckOk<T>;

const LIST_ROOM = 'lobbies:list';
function lobbyRoom(id: string): string {
  return `lobby:${id}`;
}

/**
 * Parse a raw `Cookie:` header value into a {name: value} map. Mirrors what
 * `@fastify/cookie` does on the REST side. Kept inline to avoid pulling cookie
 * parsing into a separate dep for a single header.
 */
function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

@WebSocketGateway({
  namespace: LOBBY_NAMESPACE,
  // Same-origin: nginx proxies /socket.io/ to api. No need for CORS here.
})
export class LobbiesGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(LobbiesGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly sessions: SessionService,
    private readonly lobbies: LobbiesService,
  ) {}

  onModuleInit(): void {
    // Wire the service-side event bus to our broadcast logic.
    this.lobbies.setEventBus({
      lobbyCreated: (lobby) => this.broadcastListAdded(lobby),
      lobbyUpdated: (lobby) => {
        this.broadcastLobbyState(lobby);
        this.broadcastListUpdated(lobby);
      },
      lobbyDeleted: (id) => this.broadcastDeleted(id),
      lobbyArchived: (id) => this.broadcastArchived(id),
      lobbyStarted: (lobby, gameId) => this.broadcastStarted(lobby, gameId),
    });
  }

  /**
   * Install the cookie-session auth middleware at namespace level so any
   * unauthenticated socket is rejected DURING the handshake (before the client
   * sees `connect`). Running this in {@link handleConnection} would mean we
   * authenticate after the connection is already established, leaving a short
   * window where the client could `emit()` events.
   */
  afterInit(server: Server): void {
    // Server is the engine-wide server; pick the lobbies namespace explicitly.
    // Some test harnesses surface `server.of(...)` returning `undefined`, so we
    // fall back to `server.use(...)` if that happens.
    const ns = typeof server?.of === 'function' ? server.of(LOBBY_NAMESPACE) : undefined;
    const target = ns ?? server;
    if (!target || typeof target.use !== 'function') {
      this.logger.warn('WS server does not expose a `.use()` middleware hook');
      return;
    }
    target.use(async (socket, next) => {
      try {
        const cookieHeader = socket.handshake.headers.cookie;
        const cookies = parseCookies(cookieHeader);
        const sid = cookies[SESSION_COOKIE_NAME];
        if (!sid) {
          return next(new Error('UNAUTHORIZED'));
        }
        const session = await this.sessions.get(sid);
        if (!session) {
          return next(new Error('UNAUTHORIZED'));
        }
        socket.data.userId = session.userId;
        socket.data.sessionId = sid;
        // Lazy TTL refresh, same as REST AuthGuard.
        this.sessions.touch(sid).catch(() => undefined);
        return next();
      } catch (err) {
        this.logger.error({ err }, 'WS handshake middleware failed');
        return next(new Error('UNAUTHORIZED'));
      }
    });
  }

  // -------- connection lifecycle --------

  async handleConnection(client: Socket): Promise<void> {
    // The auth middleware installed in `afterInit` has already populated
    // `client.data.userId` (or rejected the handshake). Nothing to do here;
    // kept as a no-op to preserve the OnGatewayConnection contract.
    void client;
  }

  handleDisconnect(client: Socket): void {
    // Intentionally no auto-leave on disconnect — players who briefly lose
    // their connection should keep their seat. The lobby idle TTL (1h) cleans
    // up truly abandoned ones. Phase 4+ may add explicit presence tracking.
    void client;
  }

  // -------- client -> server --------

  @SubscribeMessage(LOBBY_EVENTS.subscribe)
  async onSubscribe(@ConnectedSocket() client: Socket): Promise<Ack<{ items: LobbySummary[] }>> {
    await client.join(LIST_ROOM);
    const items = await this.lobbies.list();
    // Push a fresh snapshot to this socket only.
    client.emit(LOBBY_EVENTS.list, { items });
    return { ok: true, data: { items } };
  }

  @SubscribeMessage(LOBBY_EVENTS.unsubscribe)
  async onUnsubscribe(@ConnectedSocket() client: Socket): Promise<Ack<{ ok: true }>> {
    await client.leave(LIST_ROOM);
    return { ok: true, data: { ok: true } };
  }

  @SubscribeMessage(LOBBY_EVENTS.join)
  async onJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { lobbyId?: string },
  ): Promise<Ack<{ lobby: Lobby }>> {
    return this.run(async () => {
      const userId = this.requireUserId(client);
      const lobbyId = this.requireLobbyId(body);
      const lobby = await this.lobbies.join(userId, lobbyId);
      await client.join(lobbyRoom(lobbyId));
      // Send the fresh state straight back so the joiner doesn't have to wait
      // for the broadcast from `lobbyUpdated`.
      client.emit(LOBBY_EVENTS.state, { lobby });
      return { lobby };
    });
  }

  @SubscribeMessage(LOBBY_EVENTS.leave)
  async onLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { lobbyId?: string },
  ): Promise<Ack<{ ok: true }>> {
    return this.run(async () => {
      const userId = this.requireUserId(client);
      const lobbyId = this.requireLobbyId(body);
      await this.lobbies.leave(userId, lobbyId);
      await client.leave(lobbyRoom(lobbyId));
      return { ok: true };
    });
  }

  @SubscribeMessage(LOBBY_EVENTS.updateSettings)
  async onUpdateSettings(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { lobbyId?: string; settings?: Partial<LobbySettings> },
  ): Promise<Ack<{ lobby: Lobby }>> {
    return this.run(async () => {
      const userId = this.requireUserId(client);
      const lobbyId = this.requireLobbyId(body);
      const lobby = await this.lobbies.updateSettings(userId, lobbyId, body?.settings ?? {});
      return { lobby };
    });
  }

  @SubscribeMessage(LOBBY_EVENTS.setReady)
  async onSetReady(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { lobbyId?: string; ready?: boolean },
  ): Promise<Ack<{ lobby: Lobby }>> {
    return this.run(async () => {
      const userId = this.requireUserId(client);
      const lobbyId = this.requireLobbyId(body);
      const lobby = await this.lobbies.setReady(userId, lobbyId, !!body?.ready);
      return { lobby };
    });
  }

  @SubscribeMessage(LOBBY_EVENTS.start)
  async onStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { lobbyId?: string },
  ): Promise<Ack<{ lobby: Lobby; gameId: string }>> {
    return this.run(async () => {
      const userId = this.requireUserId(client);
      const lobbyId = this.requireLobbyId(body);
      const { lobby, gameId } = await this.lobbies.start(userId, lobbyId);
      return { lobby, gameId };
    });
  }

  // -------- broadcasters (called from the event bus) --------

  private broadcastLobbyState(lobby: Lobby): void {
    this.server.to(lobbyRoom(lobby.id)).emit(LOBBY_EVENTS.state, { lobby });
  }

  private broadcastListAdded(lobby: Lobby): void {
    this.server.to(LIST_ROOM).emit(LOBBY_EVENTS.added, { lobby: lobbySummary(lobby) });
  }

  private broadcastListUpdated(lobby: Lobby): void {
    if (lobby.status === 'in_game') return;
    this.server.to(LIST_ROOM).emit(LOBBY_EVENTS.updated, { lobby: lobbySummary(lobby) });
  }

  private broadcastDeleted(lobbyId: string): void {
    this.server.to(lobbyRoom(lobbyId)).emit(LOBBY_EVENTS.deleted, { lobbyId });
    this.server.to(LIST_ROOM).emit(LOBBY_EVENTS.removed, { lobbyId });
  }

  /**
   * Lobby successfully started: only the public list needs to drop it. The
   * per-lobby room must NOT receive `lobby:deleted` because its clients are
   * already navigating to `/games/<id>` via `lobby:started`.
   */
  private broadcastArchived(lobbyId: string): void {
    this.server.to(LIST_ROOM).emit(LOBBY_EVENTS.removed, { lobbyId });
  }

  private broadcastStarted(lobby: Lobby, gameId: string): void {
    this.server.to(lobbyRoom(lobby.id)).emit(LOBBY_EVENTS.started, { gameId });
  }

  // -------- helpers --------

  private requireUserId(client: Socket): string {
    const uid = client.data?.userId as string | undefined;
    if (!uid) {
      throw new GatewayError('UNAUTHORIZED', 'Not authenticated');
    }
    return uid;
  }

  private requireLobbyId(body: { lobbyId?: string } | undefined): string {
    const id = body?.lobbyId?.trim();
    if (!id) {
      throw new GatewayError('BAD_REQUEST', 'lobbyId is required');
    }
    return id;
  }

  /**
   * Uniform ack envelope. Maps HttpException-style errors thrown by the
   * service layer (which uses Nest's exceptions for consistency with REST)
   * into a typed `{error: {...}}` ack the client can pattern-match on.
   */
  private async run<T>(fn: () => Promise<T>): Promise<Ack<T>> {
    try {
      const data = await fn();
      return { ok: true, data };
    } catch (err) {
      const payload = extractErr(err);
      return { error: payload };
    }
  }
}

class GatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly userMessage: string,
    public readonly details?: unknown,
  ) {
    super(userMessage);
  }
}

interface NestHttpExceptionLike {
  getStatus(): number;
  getResponse(): unknown;
}

function isNestHttpException(err: unknown): err is NestHttpExceptionLike {
  return (
    !!err &&
    typeof err === 'object' &&
    typeof (err as NestHttpExceptionLike).getResponse === 'function' &&
    typeof (err as NestHttpExceptionLike).getStatus === 'function'
  );
}

function extractErr(err: unknown): { code: string; message: string; details?: unknown } {
  if (err instanceof GatewayError) {
    return { code: err.code, message: err.userMessage, details: err.details };
  }
  if (isNestHttpException(err)) {
    const r = err.getResponse();
    if (r && typeof r === 'object') {
      const o = r as Record<string, unknown>;
      const code = typeof o.code === 'string' ? o.code : 'ERROR';
      const message = typeof o.message === 'string' ? o.message : 'Error';
      const details = o.details;
      return details !== undefined ? { code, message, details } : { code, message };
    }
  }
  return { code: 'INTERNAL_ERROR', message: 'Internal error' };
}
