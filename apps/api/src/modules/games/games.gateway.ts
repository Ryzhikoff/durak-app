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
  PAUSE_DISCONNECT_GRACE_SECONDS,
  type ChatMessage,
  type ChatReactionUpdate,
  type PauseInfo,
  type PauseVote,
  type PlayerReactionPayload,
} from '@durak/shared-types';
import { SESSION_COOKIE_NAME } from '../auth/auth.constants';
import { SessionService } from '../auth/session.service';
import { GamesService } from './games.service';
import { GamesPauseService } from './games-pause.service';
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
    private readonly pause: GamesPauseService,
  ) {}

  /**
   * In-memory timers for the disconnect grace window. Keyed by gameId so we
   * can cancel them on reconnect-all. Survives only the lifetime of the api
   * process; an api restart resurrects them from Redis in {@link onModuleInit}.
   */
  private readonly graceTimers = new Map<string, NodeJS.Timeout>();

  onModuleInit(): void {
    this.games.setEventBus({
      gameUpdated: (state, events) => this.broadcastUpdate(state, events, false),
      gameEnded: (state, events) => this.broadcastUpdate(state, events, true),
      chatMessage: (gameId, message) => this.broadcastChatMessage(gameId, message),
      chatReaction: (gameId, update) => this.broadcastChatReaction(gameId, update),
      playerReaction: (gameId, payload) => this.broadcastPlayerReaction(gameId, payload),
    });
    // Resurrect grace-window timers for any games that were already paused
    // before the api restarted. In-memory state is lost but the Redis blob
    // tells us how much time is left. Best-effort: if the SCAN fails (Redis
    // not ready yet) the next disconnect/reconnect will fix things.
    void this.resumePauseTimers();
  }

  /**
   * On boot, walk every `game:*:pause` blob and reinstall a grace timer per
   * game that hasn't yet opened a vote. Idempotent — calling it twice merely
   * re-arms the same timers.
   */
  private async resumePauseTimers(): Promise<void> {
    try {
      const ids = await this.pause.listPaused();
      for (const gameId of ids) {
        const info = await this.pause.get(gameId);
        if (!info) continue;
        if (info.voteOpen) continue;
        const remainingMs = Math.max(0, new Date(info.timeoutAt).getTime() - Date.now());
        this.armGraceTimer(gameId, remainingMs);
      }
      if (ids.length > 0) {
        this.logger.log({ count: ids.length }, 'resumePauseTimers: rehydrated grace timers');
      }
    } catch (err) {
      this.logger.warn({ err }, 'resumePauseTimers failed');
    }
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

  async handleConnection(_client: Socket): Promise<void> {
    // Phase 8 — connect alone is NOT enough to lift a pause. The `/games`
    // namespace is shared between the game-table page and the rating / lobby
    // pages, so a user who is paused in game `g1` and then opens `/rating`
    // would otherwise spuriously resume `g1` from the moment they navigated
    // away. The pause is lifted only once the user actually re-enters the
    // game room — see {@link onSubscribe}, which calls `handleReconnect`
    // when the subscribing socket's user appears in `disconnectedUserIds`.
    return;
  }

  async handleDisconnect(client: Socket): Promise<void> {
    // Phase 8 — disconnect grace. We treat a "disconnect" as the moment the
    // user has 0 sockets left in this game's room (multi-tab safe). The
    // userId is captured here BEFORE the socket actually leaves because by
    // the time `disconnect` fires the socket is already off the room set.
    const userId = client.data?.userId as string | undefined;
    if (!userId) return;
    try {
      const gameId = await this.lookupActiveGameId(userId);
      if (!gameId) return;
      // Defer to next tick so socket.io has actually torn the socket out of
      // its room before we count `fetchSockets()`. Without this the count
      // includes the disconnecting socket and a single-tab user looks
      // connected to us.
      setImmediate(() => {
        void this.handleDisconnectAfterTeardown(gameId, userId);
      });
    } catch (err) {
      this.logger.warn({ err }, 'handleDisconnect probe failed');
    }
  }

  private async handleDisconnectAfterTeardown(gameId: string, userId: string): Promise<void> {
    try {
      const stillThere = await this.countUserSocketsInRoom(gameId, userId);
      if (stillThere > 0) return; // another tab is still attached.
      const state = await this.games.tryGet(gameId);
      if (!state) return;
      if (state.status === 'game_over') return;
      const seat = state.players.find((p) => p.id === userId);
      if (!seat) return;
      // The disconnected user can't be the only seat in the room — that's
      // typically the "everyone left" case. Still flag the pause so the
      // returning player sees a coherent state, but do nothing else.
      const info = await this.pause.markDisconnected(gameId, userId);
      this.broadcastPause(gameId, info);
      // If a grace timer is already armed (another disconnect started one)
      // we don't reset it — pause stays anchored to the FIRST disconnect.
      if (!this.graceTimers.has(gameId) && !info.voteOpen) {
        const remainingMs = Math.max(0, new Date(info.timeoutAt).getTime() - Date.now());
        this.armGraceTimer(gameId, remainingMs);
      }
    } catch (err) {
      this.logger.warn({ err, gameId, userId }, 'handleDisconnectAfterTeardown failed');
    }
  }

  private async handleReconnect(gameId: string, userId: string): Promise<void> {
    const info = await this.pause.markReconnected(gameId, userId);
    if (info === null) {
      // Everyone is back — clear the timer and tell the room the game resumed.
      this.cancelGraceTimer(gameId);
      const state = await this.games.tryGet(gameId);
      if (state) {
        this.broadcastResume(gameId, state);
      }
      return;
    }
    // Still missing somebody. Re-broadcast the new disconnected set so the UI
    // refreshes its label. Vote, if already open, picks up the new eligible
    // voter list automatically.
    this.broadcastPause(gameId, info);
    if (info.voteOpen) {
      await this.tallyAndMaybeFinish(gameId, info);
    }
  }

  /**
   * Count of distinct sockets in this game's room that belong to `userId`.
   * Multi-tab users can be present multiple times; >0 means at least one tab
   * is still alive and the user is NOT considered disconnected.
   */
  private async countUserSocketsInRoom(gameId: string, userId: string): Promise<number> {
    const ns = this.server?.of?.(GAME_NAMESPACE) ?? this.server;
    if (!ns) return 0;
    try {
      const sockets = await ns.in(gameRoom(gameId)).fetchSockets();
      let n = 0;
      for (const s of sockets) {
        if ((s.data?.userId as string | undefined) === userId) n++;
      }
      return n;
    } catch (err) {
      this.logger.warn({ err, gameId, userId }, 'countUserSocketsInRoom failed');
      return 0;
    }
  }

  /** Set of userIds currently with at least one socket attached to the game room. */
  private async connectedUserIdsInRoom(gameId: string): Promise<string[]> {
    const ns = this.server?.of?.(GAME_NAMESPACE) ?? this.server;
    if (!ns) return [];
    try {
      const sockets = await ns.in(gameRoom(gameId)).fetchSockets();
      const set = new Set<string>();
      for (const s of sockets) {
        const id = s.data?.userId as string | undefined;
        if (id) set.add(id);
      }
      return Array.from(set);
    } catch {
      return [];
    }
  }

  /**
   * Reverse lookup for "what live game is this user seated in?". Thin wrapper
   * around the games service so the gateway never reaches into its private
   * Redis client directly.
   */
  private async lookupActiveGameId(userId: string): Promise<string | null> {
    return this.games.lookupActiveGameId(userId);
  }

  private armGraceTimer(gameId: string, delayMs: number): void {
    this.cancelGraceTimer(gameId);
    const t = setTimeout(() => {
      this.graceTimers.delete(gameId);
      void this.openVoteAfterGrace(gameId);
    }, delayMs);
    // Don't keep the node process alive just for this — it's user-driven.
    if (typeof (t as { unref?: () => void }).unref === 'function') {
      (t as { unref?: () => void }).unref!();
    }
    this.graceTimers.set(gameId, t);
  }

  private cancelGraceTimer(gameId: string): void {
    const t = this.graceTimers.get(gameId);
    if (t) {
      clearTimeout(t);
      this.graceTimers.delete(gameId);
    }
  }

  private async openVoteAfterGrace(gameId: string): Promise<void> {
    try {
      const info = await this.pause.openVote(gameId);
      if (!info) return;
      this.broadcastVoteStarted(gameId, info);
      // Eligible voters might be zero already (everyone is finished, or all
      // remaining seats are also disconnected). In that case tally immediately
      // — the tally helper bails out cleanly when there's no one to vote.
      await this.tallyAndMaybeFinish(gameId, info);
    } catch (err) {
      this.logger.warn({ err, gameId }, 'openVoteAfterGrace failed');
    }
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
      pauseInfo: PauseInfo | null;
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
      // Phase 8 — a reconnecting user gets the current pause snapshot in the
      // same round-trip. Also probes membership in the disconnected list so a
      // resubscribe (which may have been triggered by the reconnect itself)
      // clears the user from the pause without waiting for the connection
      // hook to fire a second time.
      let pauseInfo = await this.pause.get(gameId);
      if (pauseInfo && pauseInfo.disconnectedUserIds.includes(userId)) {
        // The user is back — clear their disconnect mark now, exactly like
        // `handleConnection` would. `handleReconnect` also broadcasts the
        // appropriate `game:resumed` / `game:paused` event to the room so the
        // other players' overlays update; we then re-read the (possibly
        // cleared) pause snapshot to include the fresh value in our own ack.
        await this.handleReconnect(gameId, userId);
        pauseInfo = await this.pause.get(gameId);
      }
      const snapshot = redactForPlayer(state, userId, profiles);
      // Push initial state straight to this socket (matches the lobbies pattern).
      client.emit(GAME_EVENTS.state, { state: snapshot });
      return { state: snapshot, recentEvents, chatHistory, pauseInfo };
    });
  }

  @SubscribeMessage(GAME_EVENTS.pauseVote)
  async onPauseVote(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { gameId?: string; vote?: PauseVote },
  ): Promise<Ack<{ ok: true }>> {
    return this.run(async () => {
      const userId = this.requireUserId(client);
      const gameId = this.requireGameId(body);
      const vote = body?.vote;
      if (vote !== 'wait_more' && vote !== 'concede') {
        throw new GatewayError('BAD_REQUEST', 'Invalid vote');
      }
      const state = await this.games.tryGet(gameId);
      if (!state) {
        throw new GatewayError('GAME_NOT_FOUND', 'Game not found');
      }
      if (!state.players.some((p) => p.id === userId)) {
        throw new GatewayError('GAME_NOT_FOUND', 'Game not found');
      }
      // Finished players are spectators of the pause — they don't get a ballot.
      // (They've already left the active rotation and shouldn't influence
      // whether the remaining live seats wait or concede.)
      if (state.finishedPlayers.includes(userId)) {
        throw new GatewayError('VOTE_NOT_ALLOWED', 'Finished players cannot vote');
      }
      // Defensive: a disconnected user submitting a vote shouldn't be possible
      // (they have no live socket), but a stale tab race could try it. Reject
      // it cleanly here so the persistence layer never even sees the call.
      const liveInfo = await this.pause.get(gameId);
      if (liveInfo?.disconnectedUserIds.includes(userId)) {
        throw new GatewayError('VOTE_NOT_ALLOWED', 'Disconnected players cannot vote');
      }
      const recorded = await this.pause.castVote(gameId, userId, vote);
      if (!recorded) {
        throw new GatewayError('VOTE_NOT_ALLOWED', 'Vote is not open or not allowed');
      }
      this.broadcastVoteUpdate(gameId, recorded);
      await this.tallyAndMaybeFinish(gameId, recorded);
      return { ok: true as const };
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

  @SubscribeMessage(GAME_EVENTS.reactionSend)
  async onReactionSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { gameId?: string; emoji?: string },
  ): Promise<Ack<{ ok: true }>> {
    return this.run(async () => {
      const userId = this.requireUserId(client);
      const gameId = this.requireGameId(body);
      const emoji = typeof body?.emoji === 'string' ? body.emoji : '';
      if (!emoji || emoji.length > 16) {
        throw new GatewayError('REACTION_INVALID', 'Reaction is required');
      }
      await this.games.recordReaction(gameId, userId, emoji);
      return { ok: true as const };
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
    // When a game ends, fan out a minimal public broadcast to every socket on
    // the `/games` namespace. Players sitting on the rating / home page are
    // NOT in this game's room, so they would never observe the per-room
    // `game:over` event. The public broadcast carries only an id + timestamp
    // — enough to drive cache invalidation, no state leak.
    if (over) {
      const publicNs = this.server?.of?.(GAME_NAMESPACE) ?? this.server;
      try {
        publicNs?.emit(GAME_EVENTS.overPublic, {
          gameId: state.id,
          finishedAt: new Date().toISOString(),
        });
      } catch (err) {
        this.logger.warn({ err, gameId: state.id }, 'failed to broadcast public game-over');
      }
    }
  }

  // -------- pause broadcasters (Phase 8) --------

  private broadcastPause(gameId: string, info: PauseInfo): void {
    try {
      this.server.to(gameRoom(gameId)).emit(GAME_EVENTS.paused, {
        gameId,
        disconnectedUserIds: info.disconnectedUserIds,
        pausedAt: info.pausedAt,
        timeoutAt: info.timeoutAt,
      });
    } catch (err) {
      this.logger.warn({ err, gameId }, 'failed to broadcast pause');
    }
  }

  private broadcastResume(gameId: string, state: GameState): void {
    try {
      this.server.to(gameRoom(gameId)).emit(GAME_EVENTS.resumed, { gameId });
    } catch (err) {
      this.logger.warn({ err, gameId }, 'failed to broadcast resume');
    }
    // Re-emit a state snapshot so the client can flush any optimistic UI it
    // froze during the pause. Use the existing per-socket redaction path.
    void this.broadcastUpdate(state, [], false);
  }

  private broadcastVoteStarted(gameId: string, info: PauseInfo): void {
    try {
      this.server.to(gameRoom(gameId)).emit(GAME_EVENTS.pauseVoteStarted, {
        gameId,
        disconnectedUserIds: info.disconnectedUserIds,
        timeoutSec: PAUSE_DISCONNECT_GRACE_SECONDS,
      });
    } catch (err) {
      this.logger.warn({ err, gameId }, 'failed to broadcast vote_started');
    }
  }

  private broadcastVoteUpdate(gameId: string, info: PauseInfo): void {
    try {
      this.server.to(gameRoom(gameId)).emit(GAME_EVENTS.pauseVoteUpdate, {
        gameId,
        votes: info.votes,
      });
    } catch (err) {
      this.logger.warn({ err, gameId }, 'failed to broadcast vote_update');
    }
  }

  private broadcastWaitExtended(gameId: string, info: PauseInfo): void {
    try {
      this.server.to(gameRoom(gameId)).emit(GAME_EVENTS.pauseWaitExtended, {
        gameId,
        timeoutAt: info.timeoutAt,
      });
    } catch (err) {
      this.logger.warn({ err, gameId }, 'failed to broadcast wait_extended');
    }
  }

  private broadcastConcedeCompleted(gameId: string, concededUserIds: string[]): void {
    try {
      this.server.to(gameRoom(gameId)).emit(GAME_EVENTS.concedeCompleted, {
        gameId,
        concededUserIds,
      });
    } catch (err) {
      this.logger.warn({ err, gameId }, 'failed to broadcast concede_completed');
    }
  }

  /**
   * Inspect the current pause + roster and apply the vote outcome. No-op if
   * voting hasn't reached a decision yet. Handles both branches:
   *  - `wait_more` wins → re-arm the grace timer for one more cycle.
   *  - `concede` wins  → finalize the game with the concede roster.
   */
  private async tallyAndMaybeFinish(gameId: string, info: PauseInfo): Promise<void> {
    if (!info.voteOpen) return;
    const state = await this.games.tryGet(gameId);
    if (!state) return;
    const connected = await this.connectedUserIdsInRoom(gameId);
    const eligible = this.pause.eligibleVoters(state, info, connected);
    // Degenerate case: no eligible voters at all — auto-concede the missing
    // seats so the game doesn't get stuck.
    if (eligible.length === 0) {
      await this.executeConcede(gameId, info.disconnectedUserIds);
      return;
    }
    const tally = this.pause.tally(info, eligible);
    if (tally.decision === null) return;
    if (tally.decision === 'wait_more') {
      const extended = await this.pause.extendWait(gameId);
      if (extended) {
        this.broadcastWaitExtended(gameId, extended);
        this.armGraceTimer(gameId, PAUSE_DISCONNECT_GRACE_SECONDS * 1000);
      }
      return;
    }
    await this.executeConcede(gameId, info.disconnectedUserIds);
  }

  private async executeConcede(gameId: string, concededUserIds: string[]): Promise<void> {
    this.cancelGraceTimer(gameId);
    // The service handles persistence + finalization + bus.gameEnded — which
    // wires through to broadcastUpdate. We just need to add the public
    // concede notice on top so the UI can label the game-over modal.
    try {
      await this.games.concedeGame(gameId, concededUserIds);
      this.broadcastConcedeCompleted(gameId, concededUserIds);
    } catch (err) {
      this.logger.error({ err, gameId }, 'executeConcede failed');
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

  /**
   * Fan out a transient seat-side reaction. Every socket in the game room
   * renders a floating bubble above the named user's seat for a short window;
   * nothing is persisted server-side.
   */
  private broadcastPlayerReaction(gameId: string, payload: PlayerReactionPayload): void {
    try {
      this.server.to(gameRoom(gameId)).emit(GAME_EVENTS.playerReaction, payload);
    } catch (err) {
      this.logger.warn({ err, gameId }, 'failed to broadcast player reaction');
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
