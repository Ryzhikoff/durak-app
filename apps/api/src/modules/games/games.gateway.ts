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
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Server, Socket } from 'socket.io';
import type { DomainEvent, GameCommand, GameState } from '@durak/game-engine';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  GAME_EVENTS,
  GAME_NAMESPACE,
  type ChatMessage,
  type ChatReactionUpdate,
} from '@durak/shared-types';
import { SESSION_COOKIE_NAME } from '../auth/auth.constants';
import { SessionService } from '../auth/session.service';
import { GamesService } from './games.service';
import { GameCommandWsDto } from './dto/game-command.dto';
import { redactForPlayer, type ClientGameState, type GameUserProfiles } from './game-redactor';

interface AckErr {
  error: { code: string; message: string; details?: unknown };
}
interface AckOk<T> {
  ok: true;
  data: T;
}

type Ack<T> = AckErr | AckOk<T>;

function gameRoom(id: string): string {
  return `game:${id}`;
}

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
  namespace: GAME_NAMESPACE,
})
export class GamesGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(GamesGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly sessions: SessionService,
    private readonly games: GamesService,
  ) {}

  onModuleInit(): void {
    this.games.setEventBus({
      gameUpdated: (state, events) => this.broadcastUpdate(state, events, false),
      gameEnded: (state, events) => this.broadcastUpdate(state, events, true),
      chatMessage: (gameId, message) => this.broadcastChatMessage(gameId, message),
      chatReaction: (gameId, update) => this.broadcastChatReaction(gameId, update),
    });
  }

  afterInit(server: Server): void {
    const ns = typeof server?.of === 'function' ? server.of(GAME_NAMESPACE) : undefined;
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
        if (!sid) return next(new Error('UNAUTHORIZED'));
        const session = await this.sessions.get(sid);
        if (!session) return next(new Error('UNAUTHORIZED'));
        socket.data.userId = session.userId;
        socket.data.sessionId = sid;
        this.sessions.touch(sid).catch(() => undefined);
        return next();
      } catch (err) {
        this.logger.error({ err }, 'WS handshake middleware failed');
        return next(new Error('UNAUTHORIZED'));
      }
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    void client;
  }

  handleDisconnect(client: Socket): void {
    // Phase 5: no auto-leave / no presence tracking. A disconnected player keeps
    // their seat; the 24h game TTL eventually reaps abandoned games. Future
    // phases (8) will add reconnect grace windows + AFK handling.
    void client;
  }

  // -------- client -> server --------

  @SubscribeMessage(GAME_EVENTS.subscribe)
  async onSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { gameId?: string },
  ): Promise<
    Ack<{
      state: ClientGameState;
      recentEvents: DomainEvent[];
      chatHistory: ChatMessage[];
    }>
  > {
    return this.run(async () => {
      const userId = this.requireUserId(client);
      const gameId = this.requireGameId(body);
      const state = await this.games.get(gameId);
      if (!state.players.some((p) => p.id === userId)) {
        throw new GatewayError('GAME_NOT_FOUND', 'Game not found');
      }
      const profiles = await this.games.getProfiles(gameId);
      const recentEvents = await this.games.getRecentEvents(gameId);
      // Chat history piggybacks on the initial subscribe so the panel can hydrate
      // without a second round-trip. Cheap: it's already a single LRANGE.
      const chatHistory = await this.games.fetchChatHistory(gameId, userId);
      await client.join(gameRoom(gameId));
      const snapshot = redactForPlayer(state, userId, profiles);
      // Push initial state straight to this socket (matches the lobbies pattern).
      client.emit(GAME_EVENTS.state, { state: snapshot });
      return { state: snapshot, recentEvents, chatHistory };
    });
  }

  @SubscribeMessage(GAME_EVENTS.chatSend)
  async onChatSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { gameId?: string; text?: string; replyToId?: string },
  ): Promise<Ack<{ message: ChatMessage }>> {
    return this.run(async () => {
      const userId = this.requireUserId(client);
      const gameId = this.requireGameId(body);
      const text = typeof body?.text === 'string' ? body.text : '';
      // Cheap pre-validation so a misuse never even reaches Redis. The service
      // re-validates after trim — this is just a fast-fail gate.
      if (text.length > CHAT_MESSAGE_MAX_LENGTH * 4) {
        throw new GatewayError('CHAT_TEXT_INVALID', 'Message too long');
      }
      const replyToId =
        typeof body?.replyToId === 'string' &&
        body.replyToId.length > 0 &&
        body.replyToId.length <= 64
          ? body.replyToId
          : undefined;
      const message = await this.games.appendChatMessage(gameId, userId, text, replyToId);
      return { message };
    });
  }

  @SubscribeMessage(GAME_EVENTS.chatReact)
  async onChatReact(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: { gameId?: string; messageId?: string; emoji?: string | null },
  ): Promise<Ack<ChatReactionUpdate>> {
    return this.run(async () => {
      const userId = this.requireUserId(client);
      const gameId = this.requireGameId(body);
      const messageId = typeof body?.messageId === 'string' ? body.messageId.trim() : '';
      if (!messageId || messageId.length > 64) {
        throw new GatewayError('BAD_REQUEST', 'messageId is required');
      }
      const emoji =
        typeof body?.emoji === 'string' && body.emoji.length > 0
          ? body.emoji
          : body?.emoji === null
            ? null
            : null;
      const update = await this.games.reactToMessage(gameId, userId, messageId, emoji);
      return update;
    });
  }

  @SubscribeMessage(GAME_EVENTS.chatFetch)
  async onChatFetch(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { gameId?: string },
  ): Promise<Ack<{ messages: ChatMessage[] }>> {
    return this.run(async () => {
      const userId = this.requireUserId(client);
      const gameId = this.requireGameId(body);
      const messages = await this.games.fetchChatHistory(gameId, userId);
      return { messages };
    });
  }

  @SubscribeMessage(GAME_EVENTS.command)
  async onCommand(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { gameId?: string; command?: GameCommand },
  ): Promise<Ack<{ ok: true }>> {
    return this.run(async () => {
      const userId = this.requireUserId(client);
      // class-validator runs against the wire envelope; the inner GameCommand
      // union is still validated by the engine reducer.
      const dto = plainToInstance(GameCommandWsDto, body ?? {});
      const errors = await validate(dto, {
        whitelist: false,
        forbidNonWhitelisted: false,
      });
      if (errors.length > 0) {
        const first = errors[0];
        const message =
          first && first.constraints
            ? (Object.values(first.constraints)[0] ?? 'Invalid payload')
            : 'Invalid payload';
        throw new GatewayError('BAD_REQUEST', message);
      }
      const gameId = this.requireGameId({ gameId: dto.gameId });
      await this.games.applyGameCommand(gameId, userId, dto.command as GameCommand);
      return { ok: true as const };
    });
  }

  // -------- bus -> broadcasters --------

  /**
   * Broadcast a state change to every member of the game's room. We emit the
   * personalised `game:state` per-socket (so opponent hands stay hidden), but
   * the public `game:events` payload is fan-out via the room.
   */
  private async broadcastUpdate(
    state: GameState,
    events: DomainEvent[],
    over: boolean,
  ): Promise<void> {
    const room = gameRoom(state.id);
    const profiles = await this.games.getProfiles(state.id).catch(() => ({}) as GameUserProfiles);

    // Per-socket personalised state.
    const ns = this.server?.of?.(GAME_NAMESPACE) ?? this.server;
    const sockets = await ns
      ?.in(room)
      .fetchSockets()
      .catch(() => []);
    for (const s of sockets ?? []) {
      const viewerId = (s.data?.userId as string | undefined) ?? '';
      if (!viewerId) continue;
      const snapshot = redactForPlayer(state, viewerId, profiles);
      try {
        s.emit(GAME_EVENTS.state, { state: snapshot });
        if (over) {
          s.emit(GAME_EVENTS.over, { state: snapshot, events });
        }
      } catch (err) {
        this.logger.warn({ err, viewerId }, 'failed to emit game state to socket');
      }
    }
    // Public events ride the room broadcast.
    if (events.length > 0) {
      this.server.to(room).emit(GAME_EVENTS.events, { events });
    }
  }

  /**
   * Fan out a new chat message to every socket currently in the game's room.
   * The sender receives their own message via this broadcast too, so the UI
   * has a single ingestion path.
   */
  private broadcastChatMessage(gameId: string, message: ChatMessage): void {
    try {
      this.server.to(gameRoom(gameId)).emit(GAME_EVENTS.chatMessage, { message });
    } catch (err) {
      this.logger.warn({ err, gameId }, 'failed to broadcast chat message');
    }
  }

  /**
   * Fan out a reaction change to every socket in the room. Clients merge it
   * into their local `message.reactions` map without re-fetching history.
   */
  private broadcastChatReaction(gameId: string, update: ChatReactionUpdate): void {
    try {
      this.server.to(gameRoom(gameId)).emit(GAME_EVENTS.chatReaction, update);
    } catch (err) {
      this.logger.warn({ err, gameId }, 'failed to broadcast chat reaction');
    }
  }

  // -------- helpers --------

  private requireUserId(client: Socket): string {
    const uid = client.data?.userId as string | undefined;
    if (!uid) {
      throw new GatewayError('UNAUTHORIZED', 'Not authenticated');
    }
    return uid;
  }

  private requireGameId(body: { gameId?: string } | undefined): string {
    const raw = body?.gameId;
    if (typeof raw !== 'string') {
      throw new GatewayError('BAD_REQUEST', 'gameId is required');
    }
    const id = raw.trim();
    if (!id) {
      throw new GatewayError('BAD_REQUEST', 'gameId is required');
    }
    // Defensive upper bound to reject obvious garbage payloads before they
    // reach the persistence layer. Real ids are UUIDs (~36 chars).
    if (id.length > 64) {
      throw new GatewayError('BAD_REQUEST', 'Invalid gameId');
    }
    return id;
  }

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
