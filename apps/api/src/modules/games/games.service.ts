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
import type { Lobby } from '@durak/shared-types';
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
}

const NOOP_BUS: GameEventBus = {
  gameUpdated: () => undefined,
  gameEnded: () => undefined,
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
