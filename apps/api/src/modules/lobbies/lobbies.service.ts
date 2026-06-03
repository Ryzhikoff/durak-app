import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ALLOWED_FIRST_BOUT_LIMITS,
  ALLOWED_TURN_TIMERS,
  DEFAULT_LOBBY_SETTINGS,
  LOBBY_PLAYER_COUNTS,
  type Lobby,
  type LobbyPlayer,
  type LobbySettings,
  type LobbySummary,
} from '@durak/shared-types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';

/** Lobby-state key prefix in Redis. Holds a JSON-encoded {@link Lobby}. */
export const LOBBY_KEY_PREFIX = 'lobby:';
/** Reverse-lookup: `userInLobby:<userId>` -> lobbyId. Used to enforce single-membership. */
export const USER_IN_LOBBY_KEY_PREFIX = 'userInLobby:';
/** Sorted set of all live lobby ids (score = createdAt epoch ms). */
export const LOBBY_INDEX_KEY = 'lobbies:index';
/** Idle TTL applied to every lobby and refreshed on every meaningful event. */
export const LOBBY_TTL_SECONDS = 60 * 60;
/** Internal mutation lock key prefix. */
const LOCK_KEY_PREFIX = 'lobby-lock:';
/** Lock TTL — long enough for any single mutation, short enough to recover from a crashed pod. */
const LOCK_TTL_MS = 5_000;
/** How many times to retry acquiring a per-lobby lock before giving up. */
const LOCK_MAX_ATTEMPTS = 50;
const LOCK_RETRY_DELAY_MS = 20;

/** Thrown when another tenant holds the per-lobby lock for too long. */
export class LobbyBusyError extends Error {
  constructor(lobbyId: string) {
    super(`Lobby ${lobbyId} is busy`);
  }
}

export interface LobbiesPrismaUserSlice {
  user: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; nickname: true; avatarUrl: true; disabledAt: true };
    }): Promise<{
      id: string;
      nickname: string;
      avatarUrl: string | null;
      disabledAt: Date | null;
    } | null>;
  };
}

interface LobbyEventBus {
  lobbyCreated(lobby: Lobby): void;
  lobbyUpdated(lobby: Lobby): void;
  /**
   * Lobby fully removed from the system (last player left / TTL'd). Notifies
   * BOTH the per-lobby room (so clients still inside get a "this room is gone"
   * signal) AND the list room (so the public list drops the entry).
   */
  lobbyDeleted(lobbyId: string): void;
  /**
   * Lobby was successfully started -> it's archived from the public list, but
   * clients inside the lobby room MUST NOT receive `lobby:deleted` because
   * they're already navigating to the game via `lobby:started`. Only the list
   * room is notified.
   */
  lobbyArchived(lobbyId: string): void;
  lobbyStarted(lobby: Lobby, gameId: string): void;
}

const NOOP_BUS: LobbyEventBus = {
  lobbyCreated: () => undefined,
  lobbyUpdated: () => undefined,
  lobbyDeleted: () => undefined,
  lobbyArchived: () => undefined,
  lobbyStarted: () => undefined,
};

function lobbyKey(id: string): string {
  return `${LOBBY_KEY_PREFIX}${id}`;
}

function userKey(userId: string): string {
  return `${USER_IN_LOBBY_KEY_PREFIX}${userId}`;
}

function lockKey(lobbyId: string): string {
  return `${LOCK_KEY_PREFIX}${lobbyId}`;
}

function generateLobbyId(): string {
  // Short, URL-safe, collision-resistant enough for live lobbies.
  return randomBytes(9).toString('base64url');
}

function generateLockToken(): string {
  return randomBytes(12).toString('base64url');
}

function generateGameId(): string {
  return randomBytes(12).toString('base64url');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Convenience: turn a partial settings patch into a fully-validated, merged settings object. */
export function mergeAndValidateSettings(
  base: LobbySettings,
  patch: Partial<LobbySettings>,
): LobbySettings {
  // Whitelist: reject any keys not present in the canonical default shape so
  // clients can't smuggle arbitrary fields into Redis via the JSON column.
  const allowed = new Set(Object.keys(DEFAULT_LOBBY_SETTINGS));
  for (const k of Object.keys(patch ?? {})) {
    if (!allowed.has(k)) {
      throw new BadRequestException({
        code: 'INVALID_SETTINGS',
        message: `Unknown setting "${k}"`,
      });
    }
  }
  const merged: LobbySettings = { ...base, ...patch };
  // maxPlayers
  if (!(LOBBY_PLAYER_COUNTS as readonly number[]).includes(merged.maxPlayers)) {
    throw new BadRequestException({
      code: 'INVALID_SETTINGS',
      message: `maxPlayers must be one of ${LOBBY_PLAYER_COUNTS.join(',')}`,
    });
  }
  if (
    !(ALLOWED_FIRST_BOUT_LIMITS as readonly (number | string)[]).includes(merged.firstBoutLimit)
  ) {
    throw new BadRequestException({
      code: 'INVALID_SETTINGS',
      message: "firstBoutLimit must be 5 | 6 | 'defender_hand'",
    });
  }
  if (merged.attackerScope !== 'all' && merged.attackerScope !== 'attacker_only') {
    throw new BadRequestException({ code: 'INVALID_SETTINGS', message: 'invalid attackerScope' });
  }
  if (typeof merged.cheatingEnabled !== 'boolean') {
    throw new BadRequestException({ code: 'INVALID_SETTINGS', message: 'invalid cheatingEnabled' });
  }
  if (
    typeof merged.cheatAttempts !== 'number' ||
    !Number.isInteger(merged.cheatAttempts) ||
    merged.cheatAttempts < 1 ||
    merged.cheatAttempts > 10
  ) {
    throw new BadRequestException({
      code: 'INVALID_SETTINGS',
      message: 'cheatAttempts must be an integer between 1 and 10',
    });
  }
  if (merged.cheatNoticeScope !== 'defender_only' && merged.cheatNoticeScope !== 'all') {
    throw new BadRequestException({
      code: 'INVALID_SETTINGS',
      message: 'invalid cheatNoticeScope',
    });
  }
  if (merged.layoutOnRepeat !== 'random' && merged.layoutOnRepeat !== 'preserve') {
    throw new BadRequestException({ code: 'INVALID_SETTINGS', message: 'invalid layoutOnRepeat' });
  }
  if (
    merged.firstTurn !== 'lowest_trump' &&
    merged.firstTurn !== 'random' &&
    merged.firstTurn !== 'previous_loser'
  ) {
    throw new BadRequestException({ code: 'INVALID_SETTINGS', message: 'invalid firstTurn' });
  }
  if (merged.deckSize !== 36 && merged.deckSize !== 52) {
    throw new BadRequestException({
      code: 'INVALID_SETTINGS',
      message: 'deckSize must be 36 or 52',
    });
  }
  if (typeof merged.jokers !== 'boolean') {
    throw new BadRequestException({ code: 'INVALID_SETTINGS', message: 'invalid jokers' });
  }
  if (!(ALLOWED_TURN_TIMERS as readonly (number | null)[]).includes(merged.turnTimer)) {
    throw new BadRequestException({
      code: 'INVALID_SETTINGS',
      message: `turnTimer must be one of ${ALLOWED_TURN_TIMERS.map((t) => (t === null ? 'null' : t)).join(',')}`,
    });
  }
  return merged;
}

function toSummary(lobby: Lobby): LobbySummary {
  return {
    ...lobby,
    playerCount: lobby.players.length,
    maxPlayers: lobby.settings.maxPlayers,
  };
}

@Injectable()
export class LobbiesService {
  private readonly logger = new Logger(LobbiesService.name);
  /** Pluggable bus the gateway wires in at construction time. */
  private bus: LobbyEventBus = NOOP_BUS;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  setEventBus(bus: LobbyEventBus): void {
    this.bus = bus;
  }

  // -------- public API --------

  /** Resolve a user's nickname + avatar from Postgres. Throws 401-ish if not found / disabled. */
  async resolvePlayer(userId: string): Promise<LobbyPlayer> {
    const u = await (this.prisma as unknown as LobbiesPrismaUserSlice).user.findUnique({
      where: { id: userId },
      select: { id: true, nickname: true, avatarUrl: true, disabledAt: true },
    });
    if (!u || u.disabledAt) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    }
    return { userId: u.id, nickname: u.nickname, avatarUrl: u.avatarUrl, isReady: false };
  }

  async create(userId: string, settingsPatch?: Partial<LobbySettings>): Promise<Lobby> {
    // Reject if user is already in some lobby.
    const existing = await this.redis.client.get(userKey(userId));
    if (existing) {
      throw new ConflictException({
        code: 'ALREADY_IN_LOBBY',
        message: 'User already in another lobby',
        details: { currentLobbyId: existing },
      });
    }
    const settings = mergeAndValidateSettings(DEFAULT_LOBBY_SETTINGS, settingsPatch ?? {});
    const player = await this.resolvePlayer(userId);
    const id = generateLobbyId();
    const createdAt = new Date().toISOString();
    const lobby: Lobby = {
      id,
      createdAt,
      status: 'waiting',
      settings,
      players: [player],
      gameId: null,
    };
    // Multi: write lobby json, mark user, add to index, all with TTL.
    const tx = this.redis.client.multi();
    tx.set(lobbyKey(id), JSON.stringify(lobby), 'EX', LOBBY_TTL_SECONDS);
    tx.set(userKey(userId), id, 'EX', LOBBY_TTL_SECONDS);
    tx.zadd(LOBBY_INDEX_KEY, Date.now(), id);
    await tx.exec();
    this.bus.lobbyCreated(lobby);
    return lobby;
  }

  async get(id: string): Promise<Lobby> {
    const raw = await this.redis.client.get(lobbyKey(id));
    if (!raw) {
      throw new NotFoundException({ code: 'LOBBY_NOT_FOUND', message: 'Lobby not found' });
    }
    return JSON.parse(raw) as Lobby;
  }

  /** Best-effort: returns null if missing (used in WS paths to avoid throwing on stale ids). */
  async tryGet(id: string): Promise<Lobby | null> {
    const raw = await this.redis.client.get(lobbyKey(id));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Lobby;
    } catch {
      return null;
    }
  }

  /** Garbage-collect lobby ids that disappeared (TTL'd or removed) from the sorted-set index. */
  private async reconcileIndex(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const pipeline = this.redis.client.pipeline();
    for (const id of ids) pipeline.exists(lobbyKey(id));
    const res = await pipeline.exec();
    const alive: string[] = [];
    const dead: string[] = [];
    res?.forEach(([, exists], i) => {
      if (exists === 1) alive.push(ids[i]);
      else dead.push(ids[i]);
    });
    if (dead.length > 0) {
      await this.redis.client.zrem(LOBBY_INDEX_KEY, ...dead);
    }
    return alive;
  }

  async list(): Promise<LobbySummary[]> {
    const ids = await this.redis.client.zrevrange(LOBBY_INDEX_KEY, 0, -1);
    const alive = await this.reconcileIndex(ids);
    if (alive.length === 0) return [];
    const pipeline = this.redis.client.pipeline();
    for (const id of alive) pipeline.get(lobbyKey(id));
    const res = await pipeline.exec();
    const out: LobbySummary[] = [];
    res?.forEach(([err, raw]) => {
      if (err || typeof raw !== 'string') return;
      try {
        const lobby = JSON.parse(raw) as Lobby;
        // Don't expose lobbies that are already in_game in the public list (Phase 4 will).
        if (lobby.status === 'in_game') return;
        out.push(toSummary(lobby));
      } catch {
        /* corrupted entry — ignore */
      }
    });
    return out;
  }

  /** Returns lobbies count for /health. */
  async count(): Promise<number> {
    return this.redis.client.zcard(LOBBY_INDEX_KEY);
  }

  // -------- WS-only mutations --------

  async join(userId: string, lobbyId: string): Promise<Lobby> {
    return this.withLock(lobbyId, async () => {
      const existing = await this.redis.client.get(userKey(userId));
      if (existing && existing !== lobbyId) {
        throw new ConflictException({
          code: 'ALREADY_IN_LOBBY',
          message: 'User already in another lobby',
          details: { currentLobbyId: existing },
        });
      }
      const lobby = await this.get(lobbyId);
      if (lobby.status !== 'waiting') {
        throw new ConflictException({
          code: 'LOBBY_LOCKED',
          message: 'Lobby is no longer accepting players',
        });
      }
      const already = lobby.players.find((p) => p.userId === userId);
      if (already) {
        // Idempotent re-join — refresh TTL and return current state.
        await this.touch(lobby, userId);
        return lobby;
      }
      if (lobby.players.length >= lobby.settings.maxPlayers) {
        throw new ConflictException({ code: 'LOBBY_FULL', message: 'Lobby is full' });
      }
      const player = await this.resolvePlayer(userId);
      lobby.players.push(player);
      await this.persist(lobby, userId);
      this.bus.lobbyUpdated(lobby);
      return lobby;
    });
  }

  /**
   * Used by the REST escape hatch: find whatever lobby the user is currently
   * in (via the `userInLobby:*` reverse pointer) and run the standard leave
   * flow on it. Returns `false` when the user wasn't in any lobby — the
   * controller maps that to 204 No Content unchanged.
   */
  async leaveCurrent(userId: string): Promise<boolean> {
    const lobbyId = await this.redis.client.get(userKey(userId));
    if (!lobbyId) return false;
    await this.leave(userId, lobbyId);
    return true;
  }

  /** Returns `null` when the lobby was deleted as a result of the leave. */
  async leave(userId: string, lobbyId: string): Promise<Lobby | null> {
    return this.withLock(lobbyId, async () => {
      const lobby = await this.tryGet(lobbyId);
      if (!lobby) {
        // Clean up stray reverse-index if any.
        await this.clearUserMembership(userId, lobbyId);
        return null;
      }
      const before = lobby.players.length;
      lobby.players = lobby.players.filter((p) => p.userId !== userId);
      if (lobby.players.length === before) {
        // Not a member — clear stale reverse pointer if it happens to match.
        await this.clearUserMembership(userId, lobbyId);
        return lobby;
      }
      if (lobby.players.length === 0) {
        await this.delete(lobby.id);
        await this.clearUserMembership(userId, lobbyId);
        this.bus.lobbyDeleted(lobby.id);
        return null;
      }
      await this.persist(lobby);
      await this.clearUserMembership(userId, lobbyId);
      this.bus.lobbyUpdated(lobby);
      return lobby;
    });
  }

  async updateSettings(
    userId: string,
    lobbyId: string,
    patch: Partial<LobbySettings>,
  ): Promise<Lobby> {
    return this.withLock(lobbyId, async () => {
      const lobby = await this.get(lobbyId);
      if (lobby.status !== 'waiting') {
        throw new ConflictException({
          code: 'LOBBY_LOCKED',
          message: 'Cannot edit settings of a non-waiting lobby',
        });
      }
      if (!lobby.players.some((p) => p.userId === userId)) {
        throw new BadRequestException({
          code: 'NOT_IN_LOBBY',
          message: 'You are not a member of this lobby',
        });
      }
      const merged = mergeAndValidateSettings(lobby.settings, patch);
      // If maxPlayers was lowered below current count -> reject.
      if (merged.maxPlayers < lobby.players.length) {
        throw new BadRequestException({
          code: 'INVALID_SETTINGS',
          message: 'maxPlayers cannot be lower than current player count',
        });
      }
      lobby.settings = merged;
      // Settings changed -> reset everyone's readiness so they must re-confirm.
      for (const p of lobby.players) p.isReady = false;
      await this.persist(lobby);
      this.bus.lobbyUpdated(lobby);
      return lobby;
    });
  }

  async setReady(userId: string, lobbyId: string, ready: boolean): Promise<Lobby> {
    return this.withLock(lobbyId, async () => {
      const lobby = await this.get(lobbyId);
      if (lobby.status !== 'waiting') {
        throw new ConflictException({
          code: 'LOBBY_LOCKED',
          message: 'Cannot change readiness in a non-waiting lobby',
        });
      }
      const player = lobby.players.find((p) => p.userId === userId);
      if (!player) {
        throw new BadRequestException({
          code: 'NOT_IN_LOBBY',
          message: 'You are not a member of this lobby',
        });
      }
      if (player.isReady === ready) return lobby;
      player.isReady = ready;
      await this.persist(lobby);
      this.bus.lobbyUpdated(lobby);
      return lobby;
    });
  }

  async start(userId: string, lobbyId: string): Promise<{ lobby: Lobby; gameId: string }> {
    return this.withLock(lobbyId, async () => {
      const lobby = await this.get(lobbyId);
      if (lobby.status !== 'waiting') {
        throw new ConflictException({
          code: 'LOBBY_LOCKED',
          message: 'Lobby has already started',
        });
      }
      if (!lobby.players.some((p) => p.userId === userId)) {
        throw new BadRequestException({
          code: 'NOT_IN_LOBBY',
          message: 'You are not a member of this lobby',
        });
      }
      if (lobby.players.length < 2) {
        throw new BadRequestException({
          code: 'NOT_ENOUGH_PLAYERS',
          message: 'Need at least 2 players to start',
        });
      }
      if (!lobby.players.every((p) => p.isReady)) {
        throw new BadRequestException({
          code: 'NOT_ALL_READY',
          message: 'All players must be ready to start',
        });
      }
      const gameId = generateGameId();
      lobby.status = 'in_game';
      lobby.gameId = gameId;
      await this.persist(lobby);
      // Drop from the public list so the index doesn't grow without bound (Phase 4
      // will register real games separately).
      await this.redis.client.zrem(LOBBY_INDEX_KEY, lobby.id);
      // Free up each player's userInLobby pointer so they can create a new lobby
      // once the (fake) game ends.
      const tx = this.redis.client.multi();
      for (const p of lobby.players) tx.del(userKey(p.userId));
      // Lobby itself can disappear quickly — Phase 4 will manage game lifecycle.
      tx.del(lobbyKey(lobby.id));
      await tx.exec();
      this.bus.lobbyStarted(lobby, gameId);
      // NB: archived, NOT deleted — the per-lobby room must NOT receive
      // `lobby:deleted` here, otherwise clients that just got `lobby:started`
      // would navigate to `/` and overwrite the `/games/<id>` redirect.
      this.bus.lobbyArchived(lobby.id);
      return { lobby, gameId };
    });
  }

  // -------- internals --------

  private async persist(lobby: Lobby, addUserToMembership?: string): Promise<void> {
    const tx = this.redis.client.multi();
    tx.set(lobbyKey(lobby.id), JSON.stringify(lobby), 'EX', LOBBY_TTL_SECONDS);
    if (addUserToMembership) {
      tx.set(userKey(addUserToMembership), lobby.id, 'EX', LOBBY_TTL_SECONDS);
    }
    // Sliding-window TTL on every active player's reverse pointer.
    for (const p of lobby.players) {
      tx.expire(userKey(p.userId), LOBBY_TTL_SECONDS);
    }
    await tx.exec();
  }

  private async touch(lobby: Lobby, userId: string): Promise<void> {
    const tx = this.redis.client.multi();
    tx.expire(lobbyKey(lobby.id), LOBBY_TTL_SECONDS);
    tx.expire(userKey(userId), LOBBY_TTL_SECONDS);
    await tx.exec();
  }

  private async delete(lobbyId: string): Promise<void> {
    const tx = this.redis.client.multi();
    tx.del(lobbyKey(lobbyId));
    tx.zrem(LOBBY_INDEX_KEY, lobbyId);
    await tx.exec();
  }

  /**
   * Best-effort clearing of a user's reverse pointer. Uses a Lua CAS so we only
   * drop the key when it actually points at the given lobbyId (avoids racing
   * with a concurrent join into a different lobby).
   */
  private async clearUserMembership(userId: string, lobbyId: string): Promise<void> {
    const lua = `
      local v = redis.call('GET', KEYS[1])
      if v == ARGV[1] then
        redis.call('DEL', KEYS[1])
        return 1
      end
      return 0
    `;
    await this.redis.client.eval(lua, 1, userKey(userId), lobbyId);
  }

  /**
   * Per-lobby mutex via `SET NX PX`. Bounded retries with a short backoff.
   * Token-scoped release (Lua CAS) so we never free a lock we don't own.
   */
  private async withLock<T>(lobbyId: string, fn: () => Promise<T>): Promise<T> {
    const token = generateLockToken();
    const key = lockKey(lobbyId);
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
      this.logger.warn({ lobbyId }, 'lobby lock contention exceeded');
      throw new LobbyBusyError(lobbyId);
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

/** Helper exposed for the gateway: build a summary on demand. */
export function lobbySummary(lobby: Lobby): LobbySummary {
  return toSummary(lobby);
}
