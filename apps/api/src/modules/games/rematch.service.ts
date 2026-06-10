import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  REMATCH_SESSION_TTL_SECONDS,
  REMATCH_WINDOW_MINUTES,
  type RematchCancelReason,
  type RematchPublicUser,
  type RematchSession,
} from '@durak/shared-types';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { fisherYatesShuffle, type ShuffleFn } from '../../common/shuffle';
import { GamesService } from './games.service';
import { GamesHistoryService } from './games-history.service';

/**
 * DI token for the shuffle function used when `layoutOnRepeat === 'random'`.
 * Defaulted to {@link fisherYatesShuffle} in the module wiring; spec files
 * inject an identity or deterministic stand-in so assertions stay stable.
 */
export const REMATCH_SHUFFLE_TOKEN = Symbol('REMATCH_SHUFFLE');

/** Redis key prefix for live rematch sessions. */
export const REMATCH_KEY_PREFIX = 'rematch:';
/** Per-session lock prefix. Mirrors the games/lobbies pattern. */
const LOCK_KEY_PREFIX = 'rematch-lock:';
const LOCK_TTL_MS = 5_000;
const LOCK_MAX_ATTEMPTS = 50;
const LOCK_RETRY_DELAY_MS = 20;

function rematchKey(sourceGameId: string): string {
  return `${REMATCH_KEY_PREFIX}${sourceGameId}`;
}

function lockKey(sourceGameId: string): string {
  return `${LOCK_KEY_PREFIX}${sourceGameId}`;
}

function generateLockToken(): string {
  return randomBytes(12).toString('base64url');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bus the gateway wires in at construction time to fan WS broadcasts. The
 * service never reaches into socket.io directly; everything flows through
 * this interface so the unit tests can substitute a plain spy.
 */
export interface RematchEventBus {
  /**
   * Fired the moment a session is created. The initiator is NOT a target
   * (they already have the session via the POST response); only the OTHER
   * participants should be told.
   */
  invited(userIds: string[], session: RematchSession): void;
  /**
   * Fired whenever the live `accepted` list changes. All `expectedUserIds`
   * are targets — including the initiator, who needs to see the progress
   * bar tick up.
   */
  updated(userIds: string[], session: RematchSession): void;
  /** Fired once when the new game has been created. */
  started(userIds: string[], payload: { sourceGameId: string; newGameId: string }): void;
  /** Fired once when the session is cancelled / expired / declined. */
  cancelled(
    userIds: string[],
    payload: { sourceGameId: string; reason: RematchCancelReason },
  ): void;
}

const NOOP_BUS: RematchEventBus = {
  invited: () => undefined,
  updated: () => undefined,
  started: () => undefined,
  cancelled: () => undefined,
};

/**
 * Disconnect-pause / rematch-style "wait-for-everyone" coordinator.
 *
 * Stored under `rematch:<sourceGameId>`. There is at most one session per
 * source game. The first POST creates it; concurrent POSTs from other
 * participants are idempotent accepts. When every expected user has accepted
 * we spawn a fresh game via `GamesService.createFromComposition` and broadcast
 * `rematch:started` with the new gameId. Any participant may cancel; the TTL
 * auto-cancels after {@link REMATCH_SESSION_TTL_SECONDS}.
 *
 * Concurrency story:
 *   - Session create races use a Lua CAS so only one tenant ever wins.
 *   - Mutations (accept / cancel) are guarded by a Redis lock per session.
 *   - The TTL timer is in-memory (`setTimeout`) with a Redis-backed sanity
 *     check so an api restart doesn't lose timers — they're resurrected on
 *     boot from existing keys (mirrors `GamesPauseService`).
 */
@Injectable()
export class RematchService {
  private readonly logger = new Logger(RematchService.name);
  private bus: RematchEventBus = NOOP_BUS;

  /** In-memory expiry timers, keyed by sourceGameId. */
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Shuffle function used when `layoutOnRepeat === 'random'`. Resolved via the
   * Nest container with {@link REMATCH_SHUFFLE_TOKEN}; falls back to the
   * crypto-strong {@link fisherYatesShuffle} when nothing is bound (which is
   * also the default in production wiring — see games.module.ts).
   */
  private readonly shuffle: ShuffleFn;

  constructor(
    private readonly redis: RedisService,
    private readonly games: GamesService,
    private readonly history: GamesHistoryService,
    @Optional() @Inject(REMATCH_SHUFFLE_TOKEN) shuffle?: ShuffleFn,
  ) {
    this.shuffle = shuffle ?? fisherYatesShuffle;
  }

  setEventBus(bus: RematchEventBus): void {
    this.bus = bus;
  }

  // -------- public API --------

  /**
   * `POST /games/:id/rematch` — create the session if one doesn't exist, or
   * idempotently fold the caller into an existing session's `accepted` list.
   *
   * Throws:
   *  - `GAME_NOT_FOUND` (404) — unknown source game.
   *  - `NOT_A_PARTICIPANT` (403) — caller didn't play in the source game.
   *  - `REMATCH_WINDOW_CLOSED` (400) — game finished too long ago.
   */
  async initiateOrAccept(userId: string, sourceGameId: string): Promise<RematchSession> {
    // Look at the cached state first to short-circuit repeated creates without
    // hitting Postgres. We still take the lock below for the actual mutation.
    const existing = await this.read(sourceGameId);
    if (existing) {
      return this.acceptInternal(userId, sourceGameId, existing);
    }

    // Validate the source game from Postgres before creating the session.
    const detail = await this.history.getDetail(sourceGameId);
    if (!detail) {
      throw new NotFoundException({ code: 'GAME_NOT_FOUND', message: 'Game not found' });
    }
    const isParticipant = detail.participants.some((p) => p.userId === userId);
    if (!isParticipant) {
      throw new ForbiddenException({
        code: 'NOT_A_PARTICIPANT',
        message: 'You did not play in this game',
      });
    }
    const finishedAtMs = new Date(detail.finishedAt).getTime();
    const windowMs = REMATCH_WINDOW_MINUTES * 60 * 1000;
    if (!Number.isFinite(finishedAtMs) || Date.now() - finishedAtMs > windowMs) {
      throw new BadRequestException({
        code: 'REMATCH_WINDOW_CLOSED',
        message: 'Too much time has passed since the game ended',
      });
    }

    // Build the canonical participants array (seat-order from the source game).
    const ordered = [...detail.participants].sort((a, b) => a.seatIndex - b.seatIndex);
    const participants: RematchPublicUser[] = ordered.map((p) => ({
      userId: p.userId,
      nickname: p.nickname,
      avatarUrl: p.avatarUrl,
    }));
    const expectedUserIds = participants.map((p) => p.userId);
    const initiator = participants.find((p) => p.userId === userId) ?? {
      userId,
      nickname: userId,
      avatarUrl: null,
    };
    const now = Date.now();
    const session: RematchSession = {
      sourceGameId,
      initiator,
      expectedUserIds,
      accepted: [userId],
      expiresAt: new Date(now + REMATCH_SESSION_TTL_SECONDS * 1000).toISOString(),
      settings: detail.settings,
      composition: expectedUserIds,
      participants,
    };

    // Atomically create the key — if another tenant beat us to it, we fall
    // through to the idempotent accept path.
    const created = await this.tryCreate(session);
    if (!created) {
      const reread = await this.read(sourceGameId);
      if (!reread) {
        // Race: TTL fired between SET NX rejection and our re-read. Retry
        // once from scratch (rare). A second loss surfaces as an error.
        throw new BadRequestException({
          code: 'REMATCH_RACE',
          message: 'Rematch session collided; please retry',
        });
      }
      return this.acceptInternal(userId, sourceGameId, reread);
    }

    // Schedule the TTL timer in-memory.
    this.armExpiryTimer(sourceGameId, REMATCH_SESSION_TTL_SECONDS * 1000);

    // Tell every OTHER participant. The initiator already has the session
    // via the POST response, so excluding them keeps the modal from popping
    // a second time on their screen.
    const targets = expectedUserIds.filter((id) => id !== userId);
    if (targets.length > 0) {
      this.bus.invited(targets, session);
    }
    return session;
  }

  /**
   * Idempotent accept. Throws `REMATCH_NOT_FOUND` / `REMATCH_EXPIRED` when the
   * session is gone, and `NOT_A_PARTICIPANT` when the caller isn't in the
   * expected list.
   */
  async accept(userId: string, sourceGameId: string): Promise<RematchSession> {
    const session = await this.read(sourceGameId);
    if (!session) {
      throw new NotFoundException({
        code: 'REMATCH_NOT_FOUND',
        message: 'Rematch session not found',
      });
    }
    return this.acceptInternal(userId, sourceGameId, session);
  }

  /**
   * Any expected participant may cancel. Removes the session, broadcasts
   * `rematch:cancelled` with the supplied reason. No-op when the session is
   * already gone (so a race between TTL and a manual click doesn't error
   * the user).
   */
  async cancel(
    userId: string,
    sourceGameId: string,
    reason: RematchCancelReason = 'cancelled',
  ): Promise<void> {
    await this.withLock(sourceGameId, async () => {
      const session = await this.read(sourceGameId);
      if (!session) return;
      if (!session.expectedUserIds.includes(userId)) {
        throw new ForbiddenException({
          code: 'NOT_A_PARTICIPANT',
          message: 'You did not play in this game',
        });
      }
      await this.deleteUnlocked(sourceGameId);
      this.cancelExpiryTimer(sourceGameId);
      this.bus.cancelled(session.expectedUserIds, {
        sourceGameId,
        reason,
      });
    });
  }

  /**
   * Walk every live `rematch:*` key and re-arm in-memory expiry timers. Called
   * by the gateway on module-init so an api restart doesn't strand sessions.
   */
  async resumeTimers(): Promise<void> {
    try {
      const keys = await this.redis.client.keys(`${REMATCH_KEY_PREFIX}*`);
      for (const key of keys) {
        const id = key.slice(REMATCH_KEY_PREFIX.length);
        if (!id) continue;
        const session = await this.read(id);
        if (!session) continue;
        const remaining = Math.max(0, new Date(session.expiresAt).getTime() - Date.now());
        this.armExpiryTimer(id, remaining);
      }
      if (keys.length > 0) {
        this.logger.log({ count: keys.length }, 'rematch resumeTimers: rearmed');
      }
    } catch (err) {
      this.logger.warn({ err }, 'rematch resumeTimers failed');
    }
  }

  /** Expose the live session for fanout helpers / debug. */
  async peek(sourceGameId: string): Promise<RematchSession | null> {
    return this.read(sourceGameId);
  }

  // -------- internals --------

  private async acceptInternal(
    userId: string,
    sourceGameId: string,
    initial: RematchSession,
  ): Promise<RematchSession> {
    if (!initial.expectedUserIds.includes(userId)) {
      throw new ForbiddenException({
        code: 'NOT_A_PARTICIPANT',
        message: 'You did not play in this game',
      });
    }
    let started: { sourceGameId: string; newGameId: string } | null = null;
    let finalSession = null as RematchSession | null;
    let broadcastUpdate = false;
    await this.withLock(sourceGameId, async () => {
      const session = await this.read(sourceGameId);
      if (!session) {
        throw new GoneException({
          code: 'REMATCH_EXPIRED',
          message: 'Rematch session expired',
        });
      }
      if (!session.expectedUserIds.includes(userId)) {
        throw new ForbiddenException({
          code: 'NOT_A_PARTICIPANT',
          message: 'You did not play in this game',
        });
      }
      // Idempotent accept: short-circuit when the user is already in.
      if (session.accepted.includes(userId)) {
        finalSession = session;
        return;
      }
      session.accepted = [...session.accepted, userId];
      await this.write(session);
      broadcastUpdate = true;
      finalSession = session;
      if (session.accepted.length === session.expectedUserIds.length) {
        // Full quorum — spawn the game.
        const seatsOrdered = session.composition
          .map((uid) => session.participants.find((p) => p.userId === uid))
          .filter((p): p is RematchPublicUser => !!p);
        // Honour the `layoutOnRepeat` lobby setting. 'random' uses a
        // crypto-strong Fisher–Yates shuffle so the rematch genuinely
        // re-seats players; 'preserve' keeps the source-game seat order.
        // The shuffle is non-mutating — see common/shuffle.ts.
        const seats =
          session.settings.layoutOnRepeat === 'random'
            ? this.shuffle(seatsOrdered)
            : seatsOrdered;
        if (seats.length === session.expectedUserIds.length) {
          // Determine previousLoserId from the source game so the engine can
          // honour the "loser starts" rule when configured.
          const detail = await this.history.getDetail(sourceGameId).catch(() => null);
          const previousLoserId = detail?.loserId ?? null;
          try {
            const { gameId } = await this.games.createFromComposition({
              settings: session.settings,
              players: seats.map((s) => ({
                userId: s.userId,
                nickname: s.nickname,
                avatarUrl: s.avatarUrl,
              })),
              previousLoserId,
            });
            await this.deleteUnlocked(sourceGameId);
            this.cancelExpiryTimer(sourceGameId);
            started = { sourceGameId, newGameId: gameId };
            broadcastUpdate = false;
          } catch (err) {
            // Spawn failed (Postgres flake / validation / engine error). We
            // must NOT leave the Redis session dangling for the TTL — that
            // would freeze every participant's modal for ~90s with no signal.
            // Tear the session down, broadcast `spawn_failed` so the modal
            // closes everywhere with a clear reason, then re-throw so the
            // caller of the final accept sees HTTP 500.
            this.logger.error(
              {
                err,
                sourceGameId,
                expectedUserIds: session.expectedUserIds,
              },
              'rematch spawn failed; tearing down session',
            );
            await this.deleteUnlocked(sourceGameId);
            this.cancelExpiryTimer(sourceGameId);
            this.bus.cancelled(session.expectedUserIds, {
              sourceGameId,
              reason: 'spawn_failed',
            });
            broadcastUpdate = false;
            finalSession = null;
            throw err;
          }
        }
      }
    });
    if (broadcastUpdate && finalSession) {
      this.bus.updated(finalSession.expectedUserIds, finalSession);
    }
    if (started && finalSession) {
      this.bus.started(finalSession.expectedUserIds, started);
    }
    if (!finalSession) {
      // Defensive: lock callback unset both branches — shouldn't happen.
      throw new BadRequestException({
        code: 'REMATCH_RACE',
        message: 'Rematch state unstable; please retry',
      });
    }
    return finalSession;
  }

  private async tryCreate(session: RematchSession): Promise<boolean> {
    const res = await this.redis.client.set(
      rematchKey(session.sourceGameId),
      JSON.stringify(session),
      'EX',
      REMATCH_SESSION_TTL_SECONDS,
      'NX',
    );
    return res === 'OK';
  }

  private async write(session: RematchSession): Promise<void> {
    const ttlSec = Math.max(
      1,
      Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / 1000),
    );
    await this.redis.client.set(
      rematchKey(session.sourceGameId),
      JSON.stringify(session),
      'EX',
      ttlSec,
    );
  }

  private async read(sourceGameId: string): Promise<RematchSession | null> {
    const raw = await this.redis.client.get(rematchKey(sourceGameId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RematchSession;
    } catch {
      await this.redis.client.del(rematchKey(sourceGameId)).catch(() => undefined);
      return null;
    }
  }

  /** Internal: delete bypassing the lock (caller already holds it). */
  private async deleteUnlocked(sourceGameId: string): Promise<void> {
    await this.redis.client.del(rematchKey(sourceGameId)).catch(() => undefined);
  }

  private armExpiryTimer(sourceGameId: string, delayMs: number): void {
    this.cancelExpiryTimer(sourceGameId);
    const t = setTimeout(() => {
      this.expiryTimers.delete(sourceGameId);
      void this.handleExpiry(sourceGameId);
    }, delayMs);
    if (typeof (t as { unref?: () => void }).unref === 'function') {
      (t as { unref?: () => void }).unref!();
    }
    this.expiryTimers.set(sourceGameId, t);
  }

  private cancelExpiryTimer(sourceGameId: string): void {
    const t = this.expiryTimers.get(sourceGameId);
    if (t) {
      clearTimeout(t);
      this.expiryTimers.delete(sourceGameId);
    }
  }

  private async handleExpiry(sourceGameId: string): Promise<void> {
    try {
      await this.withLock(sourceGameId, async () => {
        const session = await this.read(sourceGameId);
        if (!session) return; // already consumed
        await this.deleteUnlocked(sourceGameId);
        this.bus.cancelled(session.expectedUserIds, {
          sourceGameId,
          reason: 'expired',
        });
      });
    } catch (err) {
      this.logger.warn({ err, sourceGameId }, 'handleExpiry failed');
    }
  }

  /**
   * Per-source-game mutex via `SET NX PX`. Identical pattern to
   * `GamesService.withLock` / `LobbiesService.withLock`.
   */
  private async withLock<T>(sourceGameId: string, fn: () => Promise<T>): Promise<T> {
    const token = generateLockToken();
    const key = lockKey(sourceGameId);
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
      this.logger.warn({ sourceGameId }, 'rematch lock contention exceeded; proceeding anyway');
      return fn();
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
