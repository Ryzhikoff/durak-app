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
import type {
  ChatMessage,
  ChatMessageReply,
  Lobby,
  PlayerReactionPayload,
} from '@durak/shared-types';
import {
  CHAT_HISTORY_LIMIT,
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_REPLY_SNIPPET_MAX_LENGTH,
  EMOJI_REACTIONS,
  PLAYER_REACTION_RATE_LIMIT_MS,
} from '@durak/shared-types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import {
  redactForPlayer,
  type ClientGameState,
  type GameUserProfile,
  type GameUserProfiles,
} from './game-redactor';
import { GamesPauseService } from './games-pause.service';
import {
  collectMetrics,
  type MetricDelta,
  type MetricField,
  type PendingIllegalEntry,
} from './metrics-collector';
import { updateRatings, conservativeRating } from './rating-updater';

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
/** Per-(game,user) rate-limit gate for in-game seat reactions. */
export const REACTION_RATE_KEY_PREFIX = 'reaction-rate:';
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
/** Per-game metrics HASH suffix — `game:<id>:metrics:<userId>`. */
export const GAME_METRICS_SUFFIX = ':metrics:';
/** Per-game pending-illegal book HASH — `game:<id>:illegal`. */
export const GAME_ILLEGAL_SUFFIX = ':illegal';
/** Per-game start timestamp key — `game:<id>:startedAt` (ms epoch). */
export const GAME_STARTED_AT_SUFFIX = ':startedAt';
/** Per-game total bouts counter — `game:<id>:totalBouts` (int). */
export const GAME_TOTAL_BOUTS_SUFFIX = ':totalBouts';

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

/**
 * Loose prisma surface needed for finalization. We keep this typed as
 * `unknown` operations via the `$transaction` callback to dodge the cost of
 * mirroring the entire Prisma model surface — finalization runs against the
 * real PrismaClient at runtime.
 */
export interface GamesPrismaFinalizeSlice {
  ratingConfig: {
    findUnique(args: { where: { id: string } }): Promise<{
      initialMu: number;
      initialSigma: number;
      beta: number;
      tau: number;
      drawProbability: number;
    } | null>;
  };
  user: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: {
        id: true;
        nickname: true;
        avatarUrl: true;
        trueskillMu: true;
        trueskillSigma: true;
      };
    }): Promise<
      Array<{
        id: string;
        nickname: string;
        avatarUrl: string | null;
        trueskillMu: number;
        trueskillSigma: number;
      }>
    >;
  };
  $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

/**
 * Mirror of the Prisma transactional client surface we touch during
 * finalize. Kept as a loose shape so swapping Prisma versions doesn't break
 * the type contract — the underlying client validates at runtime.
 */
interface TxClient {
  game: {
    findUnique(args: {
      where: { id: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    create(args: {
      data: {
        id: string;
        settingsJson: object;
        startedAt: Date;
        finishedAt: Date;
        durationSec: number;
        loserId: string | null;
        totalBouts: number;
      };
    }): Promise<unknown>;
  };
  gameParticipant: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  ratingHistory: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  user: {
    update(args: {
      where: { id: string };
      data: {
        trueskillMu: number;
        trueskillSigma: number;
        gamesPlayed: { increment: number };
      };
    }): Promise<unknown>;
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
  /**
   * Transient seat-side reaction — gateway broadcasts to the per-game room so
   * every client renders a floating bubble above the named user's seat.
   * Never persisted.
   */
  playerReaction(gameId: string, payload: PlayerReactionPayload): void;
}

const NOOP_BUS: GameEventBus = {
  gameUpdated: () => undefined,
  gameEnded: () => undefined,
  chatMessage: () => undefined,
  chatReaction: () => undefined,
  playerReaction: () => undefined,
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

function metricsKey(gameId: string, userId: string): string {
  return `${GAME_KEY_PREFIX}${gameId}${GAME_METRICS_SUFFIX}${userId}`;
}

function illegalKey(gameId: string): string {
  return `${GAME_KEY_PREFIX}${gameId}${GAME_ILLEGAL_SUFFIX}`;
}

function startedAtKey(gameId: string): string {
  return `${GAME_KEY_PREFIX}${gameId}${GAME_STARTED_AT_SUFFIX}`;
}

function totalBoutsKey(gameId: string): string {
  return `${GAME_KEY_PREFIX}${gameId}${GAME_TOTAL_BOUTS_SUFFIX}`;
}

function reactionField(messageId: string, userId: string): string {
  return `${messageId}:${userId}`;
}

const VALID_REACTIONS = new Set<string>(EMOJI_REACTIONS);

function chatRateKey(gameId: string, userId: string): string {
  return `${CHAT_RATE_KEY_PREFIX}${gameId}:${userId}`;
}

function reactionRateKey(gameId: string, userId: string): string {
  return `${REACTION_RATE_KEY_PREFIX}${gameId}:${userId}`;
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
    private readonly pause?: GamesPauseService,
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

  /**
   * Look up the active game id for a given user via the reverse pointer.
   * Returns null when the user is not seated in any live game.
   */
  async lookupActiveGameId(userId: string): Promise<string | null> {
    try {
      const raw = await this.redis.client.get(userInGameKey(userId));
      return raw ?? null;
    } catch {
      return null;
    }
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
      // Phase 8 — block all commands while the game is paused due to a
      // disconnect. Voting traffic uses a different event (`game:pause_vote`),
      // so a `GAME_PAUSED` here strictly means "you cannot move pieces right
      // now". The check sits inside the per-game lock so a reconnect that
      // clears the pause races cleanly against the next command.
      if (this.pause) {
        const info = await this.pause.get(gameId);
        if (info) {
          throw new BadRequestException({
            code: 'GAME_PAUSED',
            message: 'Game is paused — waiting for disconnected players',
          });
        }
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
      // Collect per-command metric deltas and pending-illegal book diff. We
      // need the state BEFORE the command for legality checks, so we do this
      // before any persistence.
      const pendingIllegal = await this.loadPendingIllegal(gameId);
      const collected = collectMetrics({
        stateBefore: state,
        command,
        events,
        pendingIllegal,
      });
      await this.persistMutation(nextState, events);
      await this.applyMetricsDiff(gameId, collected);
      if (nextState.status === 'game_over') {
        // Finalization writes to Postgres (game/participants/rating-history)
        // and updates User.trueskill*. We retry transient failures (Postgres
        // hiccups) with exponential back-off; the find-unique guard inside
        // finalizeGame keeps the operation idempotent across retries. On
        // permanent failure we record the gameId to a Redis list so an
        // operator can replay later — silent data loss is unacceptable here.
        try {
          await this.finalizeGameWithRetry(nextState);
        } catch (err) {
          this.logger.error({ err, gameId: nextState.id }, 'Failed to finalize completed game');
        }
        this.bus.gameEnded(nextState, events);
      } else {
        this.bus.gameUpdated(nextState, events);
      }
      return { state: nextState, events };
    });
  }

  // -------- pause concede (Phase 8) --------

  /**
   * Force-finish a game by concede: every `concededUserIds` entry is treated
   * as a forfeit. We DO NOT route this through the engine reducer (no
   * concede command exists there and we don't want to introduce one mid-
   * stream). Instead we synthesise a final `game_over` state directly:
   *
   *  - Players that already finished keep their position.
   *  - Conceded players are placed at the very bottom (loser of the game is
   *    the FIRST conceded id by stable order, mirroring the durak rule of a
   *    single losing seat). When multiple players concede simultaneously they
   *    all rank last (loserId = first by seat order, others rank just above).
   *
   * The persistence + finalization path is identical to a natural game-over
   * (Postgres write, rating update, etc.), so downstream cache invalidation
   * Just Works.
   */
  async concedeGame(gameId: string, concededUserIds: string[]): Promise<GameState | null> {
    return this.withLock(gameId, async () => {
      const state = await this.tryGet(gameId);
      if (!state) return null;
      if (state.status === 'game_over') return state;
      if (concededUserIds.length === 0) return state;
      const conceded = new Set(concededUserIds);
      // Build a finishedPlayers list with the survivors first (preserving
      // existing finish order), then the conceded players in seat order.
      const finishedExisting = state.finishedPlayers.slice();
      const finishedExistingSet = new Set(finishedExisting);
      const survivors = state.players
        .map((p) => p.id)
        .filter((id) => !conceded.has(id) && !finishedExistingSet.has(id));
      // Survivors who haven't yet finished are "winners" by virtue of
      // outlasting the concede. They go at the end of the finished list above
      // the loser tier.
      const ordered = [...finishedExisting, ...survivors];
      // Loser is the first conceded id in seat order. If there are several
      // conceded users they share the bottom rank — the rating updater treats
      // them by position, so we keep them adjacent.
      const concededSeatOrdered = state.players.map((p) => p.id).filter((id) => conceded.has(id));
      const loserPlayerId = concededSeatOrdered[0] ?? null;
      const finalState: GameState = {
        ...state,
        status: 'game_over',
        // Everyone but the loser sits in the finished list ahead of them.
        finishedPlayers: [...ordered, ...concededSeatOrdered.slice(1)],
        loserPlayerId,
      };
      await this.persistMutation(finalState, []);
      // Pause is now meaningless — drop the meta-state so a returning loser's
      // client doesn't see a stale pause overlay.
      if (this.pause) {
        await this.pause.clear(gameId).catch(() => undefined);
      }
      try {
        await this.finalizeGameWithRetry(finalState);
      } catch (err) {
        this.logger.error({ err, gameId }, 'concedeGame: finalization failed');
      }
      this.bus.gameEnded(finalState, []);
      return finalState;
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
   * Record a transient in-game seat reaction. Validates whitelist + membership
   * + rate-limit; broadcasts via the bus on success. Nothing is persisted —
   * reconnecting clients miss reactions that fired while away. Mirrors the
   * `appendChatMessage` shape so the gateway path is uniform.
   */
  async recordReaction(
    gameId: string,
    userId: string,
    emoji: string,
  ): Promise<PlayerReactionPayload> {
    if (typeof emoji !== 'string' || !VALID_REACTIONS.has(emoji)) {
      throw new BadRequestException({
        code: 'REACTION_INVALID',
        message: 'Unsupported reaction',
      });
    }
    const state = await this.tryGet(gameId);
    if (!state || !state.players.some((p) => p.id === userId)) {
      throw new NotFoundException({ code: 'GAME_NOT_FOUND', message: 'Game not found' });
    }
    // Per-user rate-limit (1500ms) via SET NX PX, exactly like chat sends.
    const setRes = await this.redis.client.set(
      reactionRateKey(gameId, userId),
      '1',
      'PX',
      PLAYER_REACTION_RATE_LIMIT_MS,
      'NX',
    );
    if (setRes !== 'OK') {
      throw new BadRequestException({
        code: 'REACTION_RATE_LIMIT',
        message: 'Too many reactions — slow down',
      });
    }
    const payload: PlayerReactionPayload = {
      userId,
      emoji,
      timestamp: new Date().toISOString(),
    };
    this.bus.playerReaction(gameId, payload);
    return payload;
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
    const now = Date.now();
    const tx = this.redis.client.multi();
    tx.set(gameKey(state.id), JSON.stringify(state), 'EX', GAME_TTL_SECONDS);
    tx.set(profilesKey(state.id), JSON.stringify(profiles), 'EX', GAME_TTL_SECONDS);
    // Pin the start time so finalization can compute durationSec without
    // depending on bout 1's exact create-time. Stored as ms epoch string.
    tx.set(startedAtKey(state.id), String(now), 'EX', GAME_TTL_SECONDS);
    // Empty events list — created lazily on the first mutation. Skip here.
    for (const p of state.players) {
      tx.set(userInGameKey(p.id), state.id, 'EX', GAME_TTL_SECONDS);
    }
    tx.zadd(GAME_INDEX_KEY, now, state.id);
    await tx.exec();
  }

  private async persistMutation(state: GameState, events: DomainEvent[]): Promise<void> {
    const isOver = state.status === 'game_over';
    const ttl = isOver ? GAME_OVER_TTL_SECONDS : GAME_TTL_SECONDS;
    const tx = this.redis.client.multi();
    tx.set(gameKey(state.id), JSON.stringify(state), 'EX', ttl);
    tx.expire(profilesKey(state.id), ttl);
    tx.expire(startedAtKey(state.id), ttl);
    // Track total bouts for Game.totalBouts. The engine bumps boutNumber in
    // `startNewBout` AFTER each bout closes, so the current bout-1 + 1 = total
    // bouts ever played. We bump on BoutEnded so the counter survives reads.
    for (const ev of events) {
      tx.rpush(eventsKey(state.id), JSON.stringify(ev));
      if (ev.type === 'BoutEnded') {
        tx.incr(totalBoutsKey(state.id));
      }
    }
    tx.expire(totalBoutsKey(state.id), ttl);
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

  // -------- metrics / illegal book --------

  /**
   * Load the pending-illegal book for this game. The book is a small HASH
   * keyed by entryId → cheaterId (one entry per outstanding illegal play).
   */
  private async loadPendingIllegal(gameId: string): Promise<PendingIllegalEntry[]> {
    const raw = await this.redis.client.hgetall(illegalKey(gameId));
    const out: PendingIllegalEntry[] = [];
    for (const [entryId, cheaterId] of Object.entries(raw)) {
      if (typeof cheaterId === 'string' && cheaterId.length > 0) {
        out.push({ entryId, cheaterId });
      }
    }
    return out;
  }

  /**
   * Apply the collector's diff: bump per-(game,user) HINCRBY counters and
   * update the pending-illegal book. Performed in a single pipeline so a
   * concurrent finalize never sees a half-applied state.
   */
  private async applyMetricsDiff(
    gameId: string,
    diff: {
      deltas: MetricDelta[];
      addIllegal: PendingIllegalEntry[];
      dropIllegalEntryIds: string[];
      clearAllIllegal: boolean;
    },
  ): Promise<void> {
    if (
      diff.deltas.length === 0 &&
      diff.addIllegal.length === 0 &&
      diff.dropIllegalEntryIds.length === 0 &&
      !diff.clearAllIllegal
    ) {
      return;
    }
    const tx = this.redis.client.multi();
    const touchedUsers = new Set<string>();
    for (const d of diff.deltas) {
      touchedUsers.add(d.userId);
      tx.hincrby(metricsKey(gameId, d.userId), d.field, d.delta);
    }
    for (const uid of touchedUsers) {
      tx.expire(metricsKey(gameId, uid), GAME_TTL_SECONDS);
    }
    if (diff.addIllegal.length > 0) {
      for (const it of diff.addIllegal) {
        tx.hset(illegalKey(gameId), it.entryId, it.cheaterId);
      }
      tx.expire(illegalKey(gameId), GAME_TTL_SECONDS);
    }
    if (diff.dropIllegalEntryIds.length > 0) {
      for (const id of diff.dropIllegalEntryIds) {
        tx.hdel(illegalKey(gameId), id);
      }
    }
    if (diff.clearAllIllegal) {
      tx.del(illegalKey(gameId));
    }
    await tx.exec();
  }

  /**
   * Read per-user metrics HASHes back from Redis. Missing keys return zeros
   * so the resulting record is safe to write straight into Postgres.
   */
  private async readMetrics(
    gameId: string,
    userIds: string[],
  ): Promise<Record<string, Record<MetricField, number>>> {
    const fields: MetricField[] = [
      'attacksMade',
      'beatsMade',
      'translatesMade',
      'takesAsked',
      'cardsTaken',
      'boutsAttacked',
      'boutsDefended',
      'cheatAttemptedTotal',
      'cheatCaught',
      'cheatEscaped',
      'noticesIssued',
      'noticesCorrect',
      'noticesWrong',
    ];
    const out: Record<string, Record<MetricField, number>> = {};
    for (const uid of userIds) {
      const raw = await this.redis.client.hgetall(metricsKey(gameId, uid));
      const row: Record<MetricField, number> = {
        attacksMade: 0,
        beatsMade: 0,
        translatesMade: 0,
        takesAsked: 0,
        cardsTaken: 0,
        boutsAttacked: 0,
        boutsDefended: 0,
        cheatAttemptedTotal: 0,
        cheatCaught: 0,
        cheatEscaped: 0,
        noticesIssued: 0,
        noticesCorrect: 0,
        noticesWrong: 0,
      };
      for (const f of fields) {
        const v = raw[f];
        if (typeof v === 'string') {
          const n = Number.parseInt(v, 10);
          if (Number.isFinite(n)) row[f] = n;
        }
      }
      out[uid] = row;
    }
    return out;
  }

  // -------- finalization --------

  /** Maximum finalize attempts before we record the failure in Redis. */
  private static readonly FINALIZE_MAX_ATTEMPTS = 3;
  /** Redis list capturing finalize failures for operator-driven recovery. */
  static readonly FAILED_FINALIZATIONS_KEY = 'games:failed_finalizations';

  /**
   * Retry wrapper around {@link finalizeGame}. Exponential back-off
   * (500ms → 1s → 2s). The find-unique guard inside finalizeGame keeps it
   * safe to call multiple times: if the first attempt half-completed, the
   * retry finds the Game row already there and exits as a no-op. After
   * `FINALIZE_MAX_ATTEMPTS` we surface the failure in a dedicated Redis list
   * (`games:failed_finalizations`) so an operator can replay it manually.
   */
  async finalizeGameWithRetry(state: GameState, attempt = 1): Promise<void> {
    try {
      await this.finalizeGame(state);
    } catch (err) {
      if (attempt >= GamesService.FINALIZE_MAX_ATTEMPTS) {
        this.logger.error(
          { err, gameId: state.id, attempt },
          'finalizeGame: max retries exceeded, recording for manual recovery',
        );
        try {
          await this.redis.client.rpush(
            GamesService.FAILED_FINALIZATIONS_KEY,
            JSON.stringify({
              gameId: state.id,
              error: err instanceof Error ? err.message : String(err),
              at: new Date().toISOString(),
            }),
          );
        } catch (pushErr) {
          this.logger.error(
            { err: pushErr, gameId: state.id },
            'failed to record finalize failure in Redis',
          );
        }
        throw err;
      }
      const delay = 500 * Math.pow(2, attempt - 1);
      this.logger.warn({ err, gameId: state.id, attempt, delay }, 'finalizeGame failed; retrying');
      await sleep(delay);
      return this.finalizeGameWithRetry(state, attempt + 1);
    }
  }

  /**
   * Persist a completed game to Postgres exactly once. Idempotent: if the
   * game id already exists, we skip silently so a duplicate finalize (e.g.
   * via a redelivered ws command) is harmless. Updates each participant's
   * `User.trueskill*` + `User.gamesPlayed` in the same transaction so the
   * rating screen is always consistent with what's saved.
   */
  async finalizeGame(state: GameState): Promise<void> {
    if (state.status !== 'game_over') return;
    if (state.players.length === 0) return;
    const prisma = this.prisma as unknown as GamesPrismaFinalizeSlice;

    const playerIds = state.players.map((p) => p.id);
    const [config, users, profiles, metrics, startedAtMs, totalBoutsStr] = await Promise.all([
      prisma.ratingConfig.findUnique({ where: { id: 'singleton' } }),
      prisma.user.findMany({
        where: { id: { in: playerIds } },
        select: {
          id: true,
          nickname: true,
          avatarUrl: true,
          trueskillMu: true,
          trueskillSigma: true,
        },
      }),
      this.getProfiles(state.id),
      this.readMetrics(state.id, playerIds),
      this.redis.client.get(startedAtKey(state.id)),
      this.redis.client.get(totalBoutsKey(state.id)),
    ]);

    const cfg = {
      beta: config?.beta ?? 4.166667,
      tau: config?.tau ?? 0.083333,
      drawProbability: config?.drawProbability ?? 0.1,
    };
    const usersById = new Map(users.map((u) => [u.id, u]));

    // Build placements from finishedPlayers + loserPlayerId. finishedPlayers
    // is in finish order; the durak gets the last place. Draw: loserId=null
    // means everyone finished in the same bout — give them all rank 1.
    const placementsMap = new Map<string, number>();
    if (state.loserPlayerId == null) {
      for (const p of state.players) placementsMap.set(p.id, 1);
    } else {
      let nextPlace = 1;
      for (const id of state.finishedPlayers) {
        placementsMap.set(id, nextPlace);
        nextPlace++;
      }
      placementsMap.set(state.loserPlayerId, nextPlace);
    }

    // Skip players without a User row (e.g. soft-deleted). Their absence
    // doesn't break the game, but openskill needs every input present.
    const ratable = state.players
      .filter((p) => usersById.has(p.id))
      .map((p) => {
        const u = usersById.get(p.id)!;
        return {
          userId: p.id,
          muBefore: u.trueskillMu,
          sigmaBefore: u.trueskillSigma,
          place: placementsMap.get(p.id) ?? state.players.length,
        };
      });

    if (ratable.length === 0) {
      this.logger.warn({ gameId: state.id }, 'finalize: no rateable users; skipping');
      return;
    }

    // openskill's PlackettLuce needs at least two teams to compute a meaningful
    // update. If only one rateable participant remains (the rest are
    // soft-deleted), skip the rating computation but still persist the Game
    // and Participant rows so the history is complete.
    const outcomes = ratable.length >= 2 ? updateRatings(ratable, cfg) : [];
    const outcomesById = new Map(outcomes.map((o) => [o.userId, o]));

    const startedAt = startedAtMs ? new Date(Number.parseInt(startedAtMs, 10)) : new Date();
    const finishedAt = new Date();
    const durationSec = Math.max(
      0,
      Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
    );
    const totalBouts = totalBoutsStr ? Number.parseInt(totalBoutsStr, 10) : state.boutNumber - 1;

    const settingsJson = state.settings;

    // Single transaction: insert Game, all GameParticipants, all
    // RatingHistory rows, and bump each User's trueskill + gamesPlayed.
    await prisma.$transaction(async (tx) => {
      const t = tx as unknown as TxClient;
      // Idempotency: if the game id is already there, do nothing.
      const exists = await t.game.findUnique({ where: { id: state.id }, select: { id: true } });
      if (exists) return;

      await t.game.create({
        data: {
          id: state.id,
          settingsJson: settingsJson as unknown as object,
          startedAt,
          finishedAt,
          durationSec,
          loserId: state.loserPlayerId,
          totalBouts,
        },
      });

      for (let i = 0; i < state.players.length; i++) {
        const p = state.players[i];
        const u = usersById.get(p.id);
        if (!u) continue; // drop placement for missing users — defensive
        const place = placementsMap.get(p.id) ?? state.players.length;
        const isWinner = place === 1;
        const isLoser = state.loserPlayerId === p.id;
        const outcome = outcomesById.get(p.id);
        const muBefore = u.trueskillMu;
        const sigmaBefore = u.trueskillSigma;
        const muAfter = outcome?.muAfter ?? muBefore;
        const sigmaAfter = outcome?.sigmaAfter ?? sigmaBefore;
        const deltaDisplay =
          outcome?.deltaDisplay ??
          conservativeRating(muAfter, sigmaAfter) - conservativeRating(muBefore, sigmaBefore);
        const m = metrics[p.id] ?? null;
        const profile = profiles[p.id];
        await t.gameParticipant.create({
          data: {
            gameId: state.id,
            userId: p.id,
            place,
            seatIndex: i,
            isWinner,
            isLoser,
            muBefore,
            sigmaBefore,
            muAfter,
            sigmaAfter,
            deltaDisplay,
            nicknameSnapshot: profile?.nickname ?? u.nickname,
            avatarUrlSnapshot: profile?.avatarUrl ?? u.avatarUrl ?? null,
            attacksMade: m?.attacksMade ?? 0,
            beatsMade: m?.beatsMade ?? 0,
            translatesMade: m?.translatesMade ?? 0,
            takesAsked: m?.takesAsked ?? 0,
            cardsTaken: m?.cardsTaken ?? 0,
            boutsAttacked: m?.boutsAttacked ?? 0,
            boutsDefended: m?.boutsDefended ?? 0,
            cheatAttemptedTotal: m?.cheatAttemptedTotal ?? 0,
            cheatCaught: m?.cheatCaught ?? 0,
            cheatEscaped: m?.cheatEscaped ?? 0,
            noticesIssued: m?.noticesIssued ?? 0,
            noticesCorrect: m?.noticesCorrect ?? 0,
            noticesWrong: m?.noticesWrong ?? 0,
          },
        });
        await t.ratingHistory.create({
          data: {
            userId: p.id,
            gameId: state.id,
            muBefore,
            sigmaBefore,
            muAfter,
            sigmaAfter,
            deltaDisplay,
          },
        });
        await t.user.update({
          where: { id: p.id },
          data: {
            trueskillMu: muAfter,
            trueskillSigma: sigmaAfter,
            gamesPlayed: { increment: 1 },
          },
        });
      }
    });

    // Cleanup Redis side-state. Game state + chat live on GAME_OVER_TTL so a
    // returning client still sees the final board — we only purge what's
    // exclusively the metrics rail.
    const cleanup = this.redis.client.multi();
    cleanup.del(illegalKey(state.id));
    cleanup.del(startedAtKey(state.id));
    cleanup.del(totalBoutsKey(state.id));
    for (const id of playerIds) {
      cleanup.del(metricsKey(state.id, id));
    }
    await cleanup.exec().catch(() => undefined);
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
