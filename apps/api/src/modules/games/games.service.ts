import { randomBytes, randomInt } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  applyCommand,
  createGame,
  type DomainEvent,
  type GameCommand,
  type GameState,
  type PlayerSeat,
} from '@durak/game-engine';
import type { ChatMessage, ChatMessageReply, Lobby } from '@durak/shared-types';
import {
  CHAT_HISTORY_LIMIT,
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_REPLY_SNIPPET_MAX_LENGTH,
  EMOJI_REACTIONS,
} from '@durak/shared-types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import {
  redactForPlayer,
  type ClientGameState,
  type GameUserProfile,
  type GameUserProfiles,
} from './game-redactor';

/** Game-state key prefix in Redis. Holds a JSON-encoded {@link GameState}. */
export const GAME_KEY_PREFIX = 'game:';
/** Per-game profiles blob — `game:<id>:profiles`. */
export const GAME_PROFILES_SUFFIX = ':profiles';
/** Per-game recent-events ring (Redis list, RPUSH/LTRIM). */
export const GAME_EVENTS_SUFFIX = ':events';
/** Per-game in-memory chat (Redis list, RPUSH/LTRIM). */
export const GAME_CHAT_SUFFIX = ':chat';
/**
 * Per-game reactions HASH — `game:<id>:chat:reactions`.
 * field = `<messageId>:<userId>`, value = emoji glyph. One row per (msg, user)
 * pair makes both toggle and override O(1).
 */
export const GAME_CHAT_REACTIONS_SUFFIX = ':chat:reactions';
/** Per-(game,user) rate-limit gate for chat sends — set with PX TTL. */
export const CHAT_RATE_KEY_PREFIX = 'chat-rate:';
/** Minimum interval between two chat sends from the same user, in ms. */
export const CHAT_RATE_LIMIT_MS = 1000;
/** Reverse-lookup: `userInGame:<userId>` -> gameId. */
export const USER_IN_GAME_KEY_PREFIX = 'userInGame:';
/** Index of live games (sorted-set, score=createdAt epoch ms) for /health. */
export const GAME_INDEX_KEY = 'games:index';
/** Sliding TTL on every active game key, refreshed on each mutation. */
export const GAME_TTL_SECONDS = 60 * 60 * 24;
/** After `game_over` we keep the state around for a short while so finalists
 *  can refresh the page. After this, everything is reaped. */
export const GAME_OVER_TTL_SECONDS = 60 * 30;
/** How many of the most recent domain events we keep per game. */
export const GAME_RECENT_EVENTS_CAP = 50;

const LOCK_KEY_PREFIX = 'game-lock:';
const LOCK_TTL_MS = 5_000;
const LOCK_MAX_ATTEMPTS = 50;
const LOCK_RETRY_DELAY_MS = 20;

export class GameBusyError extends Error {
  constructor(gameId: string) {
    super(`Game ${gameId} is busy`);
  }
}

export interface GamesPrismaUserSlice {
  user: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: {
        id: true;
        nickname: true;
        avatarUrl: true;
        cardBackId: true;
        customCardBackUrl: true;
      };
    }): Promise<
      Array<{
        id: string;
        nickname: string;
        avatarUrl: string | null;
        cardBackId: string;
        customCardBackUrl: string | null;
      }>
    >;
  };
}

interface GameEventBus {
  /**
   * State or events changed in a game — gateway re-broadcasts per-room. The
   * event payload is the full state plus the incremental domain events emitted
   * by this command.
   */
  gameUpdated(state: GameState, events: DomainEvent[]): void;
  /**
   * Game has reached `game_over`. Gateway emits the dedicated `game:over` event
   * AND keeps the room alive long enough for clients to display the result.
   */
  gameEnded(state: GameState, events: DomainEvent[]): void;
  /**
   * New chat message — gateway broadcasts to the per-game room so every player
   * (including the sender, for the optimistic-confirm path) sees it once.
   */
  chatMessage(gameId: string, message: ChatMessage): void;
  /**
   * Reaction add/change/remove — gateway broadcasts so every viewer's chip row
   * updates without a re-fetch.
   */
  chatReaction(
    gameId: string,
    update: { messageId: string; userId: string; emoji: string | null },
  ): void;
}

const NOOP_BUS: GameEventBus = {
  gameUpdated: () => undefined,
  gameEnded: () => undefined,
  chatMessage: () => undefined,
  chatReaction: () => undefined,
};

function gameKey(id: string): string {
  return `${GAME_KEY_PREFIX}${id}`;
}

function profilesKey(id: string): string {
  return `${GAME_KEY_PREFIX}${id}${GAME_PROFILES_SUFFIX}`;
}

function eventsKey(id: string): string {
  return `${GAME_KEY_PREFIX}${id}${GAME_EVENTS_SUFFIX}`;
}

function chatKey(id: string): string {
  return `${GAME_KEY_PREFIX}${id}${GAME_CHAT_SUFFIX}`;
}

function chatReactionsKey(id: string): string {
  return `${GAME_KEY_PREFIX}${id}${GAME_CHAT_REACTIONS_SUFFIX}`;
}

function reactionField(messageId: string, userId: string): string {
  return `${messageId}:${userId}`;
}

const VALID_REACTIONS = new Set<string>(EMOJI_REACTIONS);

function chatRateKey(gameId: string, userId: string): string {
  return `${CHAT_RATE_KEY_PREFIX}${gameId}:${userId}`;
}

function generateChatMessageId(): string {
  return randomBytes(12).toString('base64url');
}

function userInGameKey(userId: string): string {
  return `${USER_IN_GAME_KEY_PREFIX}${userId}`;
}

function lockKey(gameId: string): string {
  return `${LOCK_KEY_PREFIX}${gameId}`;
}

function generateGameId(): string {
  return randomBytes(12).toString('base64url');
}

function generateLockToken(): string {
  return randomBytes(12).toString('base64url');
}

/**
 * Crypto-grade 32-bit seed for the engine PRNG. The engine seed is a Number,
 * so we pick a uniform sample in [0, 2^31 - 1).
 */
function generateSeed(): number {
  // `randomInt` upper bound is exclusive.
  return randomInt(0, 0x7fff_ffff);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Truncate a chat text down to {@link CHAT_REPLY_SNIPPET_MAX_LENGTH} chars. */
function snippet(text: string): string {
  if (text.length <= CHAT_REPLY_SNIPPET_MAX_LENGTH) return text;
  return text.slice(0, CHAT_REPLY_SNIPPET_MAX_LENGTH);
}

/**
 * Convert the raw HGETALL of the reactions HASH (fields = "msgId:userId") into
 * a `messageId -> { userId -> emoji }` map for fast O(1) merging into history.
 */
function groupReactions(
  raw: Record<string, string> | null | undefined,
): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  if (!raw) return out;
  for (const [field, emoji] of Object.entries(raw)) {
    const sep = field.indexOf(':');
    if (sep === -1) continue;
    const messageId = field.slice(0, sep);
    const userId = field.slice(sep + 1);
    if (!messageId || !userId) continue;
    let bucket = out.get(messageId);
    if (!bucket) {
      bucket = {};
      out.set(messageId, bucket);
    }
    bucket[userId] = emoji;
  }
  return out;
}

@Injectable()
export class GamesService {
  private readonly logger = new Logger(GamesService.name);
  private bus: GameEventBus = NOOP_BUS;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  setEventBus(bus: GameEventBus): void {
    this.bus = bus;
  }

  // -------- public API --------

  /** Returns live (non-game_over) game count for /health. */
  async count(): Promise<number> {
    return this.redis.client.zcard(GAME_INDEX_KEY);
  }

  /**
   * Create a fresh game from a started lobby. Returns the engine's gameId so
   * the caller (lobbies.service.start) can echo it back to the WS room.
   *
   * The lobby is expected to already have all of its readiness/min-players
   * checks done; this method only converts seats and persists state.
   */
  async createFromLobby(lobby: Lobby): Promise<{ gameId: string; state: GameState }> {
    if (lobby.players.length < 2) {
      // Defensive: the caller should already have rejected this. Surface as a
      // 400 so the WS gateway maps it cleanly via the existing error envelope.
      throw new BadRequestException({
        code: 'NOT_ENOUGH_PLAYERS',
        message: 'Need at least 2 players to start a game',
      });
    }
    const seats: PlayerSeat[] = lobby.players.map((p) => ({
      id: p.userId,
      nickname: p.nickname,
    }));
    const id = generateGameId();
    const state = createGame({
      id,
      seed: generateSeed(),
      settings: lobby.settings,
      players: seats,
      previousLoserId: null,
    });
    // Resolve per-user profile fields (avatar / card-back) used by the
    // redactor. The lobby seat only carries nickname + avatarUrl.
    const profiles = await this.loadProfiles(lobby);
    await this.persistNew(state, profiles);
    return { gameId: id, state };
  }

  /**
   * Fetch the canonical state. Throws 404 when missing.
   */
  async get(id: string): Promise<GameState> {
    const raw = await this.redis.client.get(gameKey(id));
    if (!raw) {
      throw new NotFoundException({ code: 'GAME_NOT_FOUND', message: 'Game not found' });
    }
    return JSON.parse(raw) as GameState;
  }

  /** Best-effort: returns null if missing. */
  async tryGet(id: string): Promise<GameState | null> {
    const raw = await this.redis.client.get(gameKey(id));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as GameState;
    } catch {
      return null;
    }
  }

  async getProfiles(id: string): Promise<GameUserProfiles> {
    const raw = await this.redis.client.get(profilesKey(id));
    if (!raw) return {};
    try {
      return JSON.parse(raw) as GameUserProfiles;
    } catch {
      return {};
    }
  }

  /** Latest N domain events; oldest first. */
  async getRecentEvents(id: string): Promise<DomainEvent[]> {
    const arr = await this.redis.client.lrange(eventsKey(id), 0, -1);
    const out: DomainEvent[] = [];
    for (const raw of arr) {
      try {
        out.push(JSON.parse(raw) as DomainEvent);
      } catch {
        /* corrupted entry — ignore */
      }
    }
    return out;
  }

  /**
   * Build a personalized snapshot for a given viewer. Throws 404 when the
   * viewer is not a participant (resource doesn't exist FROM THEIR POV).
   */
  async getClientState(gameId: string, viewerUserId: string): Promise<ClientGameState> {
    const state = await this.get(gameId);
    if (!state.players.some((p) => p.id === viewerUserId)) {
      throw new NotFoundException({ code: 'GAME_NOT_FOUND', message: 'Game not found' });
    }
    const profiles = await this.getProfiles(gameId);
    return redactForPlayer(state, viewerUserId, profiles);
  }

  /**
   * Apply a player's command. Validates membership BEFORE the engine sees the
   * command (so a malicious user can't probe other games' state via error
   * codes). On success, persists the new state, indexes the events, and
   * notifies the bus so the gateway broadcasts.
   */
  async applyGameCommand(
    gameId: string,
    viewerUserId: string,
    command: GameCommand,
  ): Promise<{ state: GameState; events: DomainEvent[] }> {
    return this.withLock(gameId, async () => {
      const state = await this.get(gameId);
      const member = state.players.find((p) => p.id === viewerUserId);
      if (!member) {
        // Same 404 we use for unrelated games — don't leak existence.
        throw new NotFoundException({ code: 'GAME_NOT_FOUND', message: 'Game not found' });
      }
      // The command must be attributed to the caller. We never trust the
      // client-supplied playerId — it's enforced server-side.
      if (command.playerId !== viewerUserId) {
        throw new ForbiddenException({
          code: 'PLAYER_MISMATCH',
          message: 'You may only send commands as yourself',
        });
      }
      const result = applyCommand(state, command);
      if (!result.ok) {
        throw new BadRequestException({
          code: result.code,
          message: result.message,
        });
      }
      const { state: nextState, events } = result;
      await this.persistMutation(nextState, events);
      if (nextState.status === 'game_over') {
        this.bus.gameEnded(nextState, events);
      } else {
        this.bus.gameUpdated(nextState, events);
      }
      return { state: nextState, events };
    });
  }

  // -------- chat --------

  /**
   * Append a new chat message to the game's Redis-only chat log. Validates:
   *  - the game exists,
   *  - the caller is a current participant,
   *  - the text is non-empty after trim and ≤ {@link CHAT_MESSAGE_MAX_LENGTH},
   *  - the caller hasn't sent another message in the last {@link CHAT_RATE_LIMIT_MS}.
   *
   * On success the message is RPUSH-ed, the list is trimmed to the last
   * {@link CHAT_HISTORY_LIMIT} entries, the TTL is refreshed to match the game
   * state, and the bus is notified so the gateway can broadcast.
   */
  async appendChatMessage(
    gameId: string,
    userId: string,
    rawText: string,
    replyToId?: string,
  ): Promise<ChatMessage> {
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (text.length === 0 || text.length > CHAT_MESSAGE_MAX_LENGTH) {
      throw new BadRequestException({
        code: 'CHAT_TEXT_INVALID',
        message: 'Chat message text must be 1..280 characters',
      });
    }

    // Membership check first so an unauthorised caller never leaks the
    // game's existence via a different error code.
    const state = await this.tryGet(gameId);
    if (!state || !state.players.some((p) => p.id === userId)) {
      throw new NotFoundException({ code: 'GAME_NOT_FOUND', message: 'Game not found' });
    }

    // Per-user rate-limit: 1 message per CHAT_RATE_LIMIT_MS via SET NX PX.
    const rateKey = chatRateKey(gameId, userId);
    const setRes = await this.redis.client.set(rateKey, '1', 'PX', CHAT_RATE_LIMIT_MS, 'NX');
    if (setRes !== 'OK') {
      throw new BadRequestException({
        code: 'CHAT_RATE_LIMIT',
        message: 'Too many messages — slow down',
      });
    }

    // Denormalise nickname/avatar at write time. The lobby fallback (used by
    // tests) makes this resilient when profiles are absent.
    const profiles = await this.getProfiles(gameId);
    const profile = profiles[userId];
    const seat = state.players.find((p) => p.id === userId);
    const nickname = profile?.nickname ?? seat?.nickname ?? 'player';
    const avatarUrl = profile?.avatarUrl ?? null;

    // Resolve replyTo against the current history. We do this AFTER taking the
    // rate gate so an unknown id still costs the caller a slot — same shape as
    // a successful send. If the target is missing we silently null the reply
    // (UX-soft: the target may have aged out, no reason to error).
    let replyTo: ChatMessageReply | null = null;
    if (typeof replyToId === 'string' && replyToId.trim().length > 0) {
      const target = await this.findChatMessageById(gameId, replyToId.trim());
      if (target) {
        replyTo = {
          messageId: target.id,
          userId: target.userId,
          nickname: target.nickname,
          textSnippet: snippet(target.text),
        };
      }
    }

    const isOver = state.status === 'game_over';
    const ttl = isOver ? GAME_OVER_TTL_SECONDS : GAME_TTL_SECONDS;
    const message: ChatMessage = {
      id: generateChatMessageId(),
      userId,
      nickname,
      avatarUrl,
      text,
      createdAt: new Date().toISOString(),
      replyTo,
      reactions: {},
    };

    const tx = this.redis.client.multi();
    tx.rpush(chatKey(gameId), JSON.stringify(message));
    tx.ltrim(chatKey(gameId), -CHAT_HISTORY_LIMIT, -1);
    tx.expire(chatKey(gameId), ttl);
    await tx.exec();

    this.bus.chatMessage(gameId, message);
    return message;
  }

  /**
   * Toggle / set / remove a reaction. Returns the resulting emoji (or null
   * when the reaction was cleared). Semantics:
   *  - calling with the same emoji the user already has -> removes it
   *  - calling with a different emoji -> overrides
   *  - calling with `null` -> removes (idempotent)
   *
   * Requires the caller to be a current participant of the game. Unknown
   * emojis are rejected with `CHAT_REACTION_INVALID`. Unknown message ids fail
   * silently (`null` returned) so a late click on an aged-out message doesn't
   * raise an error toast.
   */
  async reactToMessage(
    gameId: string,
    userId: string,
    messageId: string,
    emoji: string | null,
  ): Promise<{ messageId: string; userId: string; emoji: string | null }> {
    if (typeof messageId !== 'string' || messageId.trim().length === 0) {
      throw new BadRequestException({
        code: 'CHAT_REACTION_INVALID',
        message: 'messageId is required',
      });
    }
    if (emoji !== null && !VALID_REACTIONS.has(emoji)) {
      throw new BadRequestException({
        code: 'CHAT_REACTION_INVALID',
        message: 'Unsupported reaction',
      });
    }

    // Membership check.
    const state = await this.tryGet(gameId);
    if (!state || !state.players.some((p) => p.id === userId)) {
      throw new NotFoundException({ code: 'GAME_NOT_FOUND', message: 'Game not found' });
    }

    // Soft-validate that the target message still exists in the active
    // history. If it doesn't, drop the call silently — the chip wouldn't
    // render anyway.
    const target = await this.findChatMessageById(gameId, messageId);
    if (!target) {
      return { messageId, userId, emoji: null };
    }

    const isOver = state.status === 'game_over';
    const ttl = isOver ? GAME_OVER_TTL_SECONDS : GAME_TTL_SECONDS;
    const key = chatReactionsKey(gameId);
    const field = reactionField(messageId, userId);

    // Toggle-off when the user re-clicks their current emoji.
    const existing = await this.redis.client.hget(key, field);
    const next: string | null = emoji === null || existing === emoji ? null : emoji;

    if (next === null) {
      await this.redis.client.hdel(key, field);
    } else {
      await this.redis.client.hset(key, field, next);
      await this.redis.client.expire(key, ttl);
    }

    this.bus.chatReaction(gameId, { messageId, userId, emoji: next });
    return { messageId, userId, emoji: next };
  }

  /**
   * Return the chat history for a participant. Non-members get an empty array
   * (no leak: a guess of a real id and a wrong id look the same).
   *
   * Reactions live in a separate HASH and are merged in at read time. We do a
   * single HGETALL and partition by messageId so the result is plain
   * `Record<userId, emoji>` per message.
   */
  async fetchChatHistory(gameId: string, userId: string): Promise<ChatMessage[]> {
    const state = await this.tryGet(gameId);
    if (!state || !state.players.some((p) => p.id === userId)) {
      return [];
    }
    const raw = await this.redis.client.lrange(chatKey(gameId), 0, -1);
    const reactionsRaw = await this.redis.client.hgetall(chatReactionsKey(gameId));
    const reactionsByMessage = groupReactions(reactionsRaw);
    const out: ChatMessage[] = [];
    for (const entry of raw) {
      try {
        const msg = JSON.parse(entry) as ChatMessage;
        // Backfill fields for any pre-Phase 5.1 messages already in Redis.
        if (!msg.replyTo) msg.replyTo = null;
        msg.reactions = reactionsByMessage.get(msg.id) ?? {};
        out.push(msg);
      } catch {
        /* corrupted entry — ignore */
      }
    }
    return out;
  }

  /**
   * Look up a single chat message by id in the rolling LIST. Returns null when
   * the id has aged out of the history window.
   */
  private async findChatMessageById(
    gameId: string,
    messageId: string,
  ): Promise<ChatMessage | null> {
    const raw = await this.redis.client.lrange(chatKey(gameId), 0, -1);
    for (const entry of raw) {
      try {
        const msg = JSON.parse(entry) as ChatMessage;
        if (msg.id === messageId) return msg;
      } catch {
        /* corrupted entry — ignore */
      }
    }
    return null;
  }

  // -------- internals --------

  private async loadProfiles(lobby: Lobby): Promise<GameUserProfiles> {
    const ids = lobby.players.map((p) => p.userId);
    let users: Array<{
      id: string;
      nickname: string;
      avatarUrl: string | null;
      cardBackId: string;
      customCardBackUrl: string | null;
    }> = [];
    try {
      users = await (this.prisma as unknown as GamesPrismaUserSlice).user.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          nickname: true,
          avatarUrl: true,
          cardBackId: true,
          customCardBackUrl: true,
        },
      });
    } catch (err) {
      // Failure here is non-fatal: we fall back to the lobby's known fields.
      this.logger.warn({ err }, 'Failed to load user profiles for game; using lobby fallback');
    }
    const byId = new Map(users.map((u) => [u.id, u]));
    const out: GameUserProfiles = {};
    for (const lp of lobby.players) {
      const u = byId.get(lp.userId);
      const profile: GameUserProfile = {
        nickname: u?.nickname ?? lp.nickname,
        avatarUrl: u?.avatarUrl ?? lp.avatarUrl,
        cardBackId: u?.cardBackId ?? 'classic-1',
        customCardBackUrl: u?.customCardBackUrl ?? null,
      };
      out[lp.userId] = profile;
    }
    return out;
  }

  private async persistNew(state: GameState, profiles: GameUserProfiles): Promise<void> {
    const tx = this.redis.client.multi();
    tx.set(gameKey(state.id), JSON.stringify(state), 'EX', GAME_TTL_SECONDS);
    tx.set(profilesKey(state.id), JSON.stringify(profiles), 'EX', GAME_TTL_SECONDS);
    // Empty events list — created lazily on the first mutation. Skip here.
    for (const p of state.players) {
      tx.set(userInGameKey(p.id), state.id, 'EX', GAME_TTL_SECONDS);
    }
    tx.zadd(GAME_INDEX_KEY, Date.now(), state.id);
    await tx.exec();
  }

  private async persistMutation(state: GameState, events: DomainEvent[]): Promise<void> {
    const isOver = state.status === 'game_over';
    const ttl = isOver ? GAME_OVER_TTL_SECONDS : GAME_TTL_SECONDS;
    const tx = this.redis.client.multi();
    tx.set(gameKey(state.id), JSON.stringify(state), 'EX', ttl);
    tx.expire(profilesKey(state.id), ttl);
    for (const ev of events) {
      tx.rpush(eventsKey(state.id), JSON.stringify(ev));
    }
    // Cap the events list, oldest dropped.
    tx.ltrim(eventsKey(state.id), -GAME_RECENT_EVENTS_CAP, -1);
    tx.expire(eventsKey(state.id), ttl);
    if (isOver) {
      // Drop from the live index immediately so /health stops counting it.
      tx.zrem(GAME_INDEX_KEY, state.id);
      // Clear membership pointers: a finished game must NOT block the user from
      // creating a new lobby. We do leave the game state itself alive for
      // GAME_OVER_TTL so the client can render the final scoreboard on refresh.
      for (const p of state.players) {
        tx.del(userInGameKey(p.id));
      }
    } else {
      // Sliding TTL on per-user membership pointers.
      for (const p of state.players) {
        tx.expire(userInGameKey(p.id), ttl);
      }
    }
    await tx.exec();
  }

  /**
   * Per-game mutex via `SET NX PX`. Mirrors lobbies' lock.
   */
  private async withLock<T>(gameId: string, fn: () => Promise<T>): Promise<T> {
    const token = generateLockToken();
    const key = lockKey(gameId);
    let acquired = false;
    for (let i = 0; i < LOCK_MAX_ATTEMPTS; i++) {
      const res = await this.redis.client.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
      if (res === 'OK') {
        acquired = true;
        break;
      }
      await sleep(LOCK_RETRY_DELAY_MS);
    }
    if (!acquired) {
      this.logger.warn({ gameId }, 'game lock contention exceeded');
      throw new GameBusyError(gameId);
    }
    try {
      return await fn();
    } finally {
      const releaseLua = `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          return redis.call('DEL', KEYS[1])
        end
        return 0
      `;
      await this.redis.client.eval(releaseLua, 1, key, token).catch(() => undefined);
    }
  }
}
