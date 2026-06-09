import { Injectable, Logger } from '@nestjs/common';
import type { GameState } from '@durak/game-engine';
import type { TurnTimerState } from '@durak/shared-types';
import { RedisService } from '../../infrastructure/redis/redis.service';

/** Redis key prefix for the per-game turn-timer snapshot. */
export const TURN_TIMER_KEY_PREFIX = 'turn-timer:';

function turnTimerKey(gameId: string): string {
  return `${TURN_TIMER_KEY_PREFIX}${gameId}`;
}

/**
 * Bus the gateway wires in at construction time so we can fan a forced action
 * back into the `GamesService` (auto-take / auto-pass on expiry) without
 * pulling the gateway into the service. The interface is intentionally bare —
 * the gateway just gets a "timer fired, here's who and what status" tuple and
 * decides what command to apply.
 */
export interface TurnTimerExpiryBus {
  onExpired(gameId: string): Promise<void> | void;
}

const NOOP_BUS: TurnTimerExpiryBus = {
  onExpired: () => undefined,
};

/**
 * Compute the "currently active player" for the turn-timer purposes from the
 * canonical engine state. Returns `null` when no one is on a clock (game over,
 * dealing, or a brand-new bout with nothing on the table — the primary
 * attacker has zero pressure to act yet, see the Phase 9 spec note).
 *
 * Mapping:
 *  - `bout_defense`   → defender (must beat / take).
 *  - `bout_settle`    → primary attacker (must say "бито").
 *  - `bout_take_pending` → primary attacker (must say "пусть берёт" so the
 *    defender can finally take the table). The defender already committed
 *    here so there's no decision they need to make.
 *  - `bout_attack` + an attack already on the table → primary attacker (rare;
 *    the engine usually flips status to defense on the first attack, but the
 *    extra branch keeps us safe if a future change parks here).
 *  - everything else → null.
 */
export function computeActiveUserId(state: GameState): string | null {
  switch (state.status) {
    case 'bout_defense':
      return state.players[state.currentDefenderIndex]?.id ?? null;
    case 'bout_settle':
    case 'bout_take_pending':
      return state.players[state.currentAttackerIndex]?.id ?? null;
    case 'bout_attack':
      // No attack on the table yet → the attacker isn't strictly forced to act
      // immediately (Phase 9 spec: this case should NOT time out — the player
      // hasn't been "asked" to do anything yet). Once a single attack lands the
      // status flips to `bout_defense` and the defender is on the clock.
      if (state.table.attacks.length === 0) return null;
      return state.players[state.currentAttackerIndex]?.id ?? null;
    case 'dealing':
    case 'game_over':
    default:
      return null;
  }
}

/**
 * Per-game countdown timer used by the optional "turn timer" lobby setting.
 * Mirrors the {@link GamesPauseService} architecture:
 *  - in-memory `setTimeout` map keyed by gameId (cancelled on every state
 *    change),
 *  - Redis-backed snapshot (HASH `turn-timer:<gameId>`) so an api restart can
 *    rehydrate the remaining time via {@link resumeTimers},
 *  - explicit `expiryBus` injected by the gateway so the service can ask the
 *    gateway to fire the forced action without a circular dep.
 *
 * The service is deliberately stateless beyond the timer map: every public
 * mutation accepts a fresh {@link GameState} and recomputes the snapshot from
 * scratch. Callers are expected to hold the per-game lock from `GamesService`
 * when arming a timer (so the broadcast and the persisted state agree).
 */
@Injectable()
export class GamesTurnTimerService {
  private readonly logger = new Logger(GamesTurnTimerService.name);
  private bus: TurnTimerExpiryBus = NOOP_BUS;
  /**
   * In-memory expiry timers. Keyed by gameId. Survives only the lifetime of
   * the api process; {@link resumeTimers} re-arms anything that survived a
   * restart by consulting the Redis snapshot.
   */
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly redis: RedisService) {}

  setExpiryBus(bus: TurnTimerExpiryBus): void {
    this.bus = bus;
  }

  /**
   * Reconcile the timer to match the given state. Cancels any in-flight timer
   * first; arms a new one when there's a single eligible actor AND
   * `settings.turnTimer != null`. Persists the snapshot to Redis (or deletes
   * the key) and returns the new state so the caller can broadcast it.
   *
   * `now` is injectable for tests. Production paths always pass `Date.now()`
   * (the default).
   */
  async reconcile(state: GameState, now: number = Date.now()): Promise<TurnTimerState | null> {
    const seconds = state.settings.turnTimer;
    if (state.status === 'game_over' || seconds == null) {
      await this.clear(state.id);
      return null;
    }
    const activeUserId = computeActiveUserId(state);
    if (!activeUserId) {
      await this.clear(state.id);
      return null;
    }
    const durationMs = seconds * 1000;
    const deadlineAtMs = now + durationMs;
    const snapshot: TurnTimerState = {
      activeUserId,
      deadlineAt: new Date(deadlineAtMs).toISOString(),
      durationMs,
    };
    await this.write(state.id, snapshot);
    this.armTimer(state.id, durationMs);
    return snapshot;
  }

  /**
   * Cancel any active timer for the game and drop the Redis snapshot. Safe to
   * call repeatedly — both the timer map and the SET are idempotent.
   */
  async clear(gameId: string): Promise<void> {
    this.cancelTimer(gameId);
    try {
      await this.redis.client.del(turnTimerKey(gameId));
    } catch {
      /* swallow — best-effort */
    }
  }

  /** Read the current snapshot. Returns null when no timer is armed. */
  async peek(gameId: string): Promise<TurnTimerState | null> {
    try {
      const raw = await this.redis.client.hgetall(turnTimerKey(gameId));
      if (!raw || Object.keys(raw).length === 0) return null;
      const activeUserId = raw.activeUserId;
      const deadlineAt = raw.deadlineAt;
      const durationMsRaw = raw.durationMs;
      const durationMs = Number.parseInt(durationMsRaw ?? '', 10);
      if (!activeUserId || !deadlineAt || !Number.isFinite(durationMs)) return null;
      return { activeUserId, deadlineAt, durationMs };
    } catch {
      return null;
    }
  }

  /**
   * On boot, walk every `turn-timer:*` snapshot and re-arm the in-memory
   * `setTimeout` from the remaining wall-clock time. If the deadline has
   * already passed (api was down for the whole window) we fire immediately
   * via a 0ms timer so the forced action lands without further delay.
   */
  async resumeTimers(): Promise<void> {
    try {
      const keys = await this.redis.client.keys(`${TURN_TIMER_KEY_PREFIX}*`);
      let rehydrated = 0;
      for (const key of keys) {
        const id = key.slice(TURN_TIMER_KEY_PREFIX.length);
        if (!id) continue;
        const snapshot = await this.peek(id);
        if (!snapshot) continue;
        const remainingMs = Math.max(
          0,
          new Date(snapshot.deadlineAt).getTime() - Date.now(),
        );
        this.armTimer(id, remainingMs);
        rehydrated++;
      }
      if (rehydrated > 0) {
        this.logger.log({ count: rehydrated }, 'turn-timer resumeTimers: rehydrated');
      }
    } catch (err) {
      this.logger.warn({ err }, 'turn-timer resumeTimers failed');
    }
  }

  // -------- internals --------

  private async write(gameId: string, snapshot: TurnTimerState): Promise<void> {
    const key = turnTimerKey(gameId);
    try {
      const tx = this.redis.client.multi();
      // Replace the hash atomically so a stale field never leaks across
      // active players.
      tx.del(key);
      tx.hset(key, 'activeUserId', snapshot.activeUserId);
      tx.hset(key, 'deadlineAt', snapshot.deadlineAt);
      tx.hset(key, 'durationMs', String(snapshot.durationMs));
      // Sliding TTL keeps the snapshot from outliving the game itself; the
      // value is wildly more than any single turn duration (2 m hard ceiling
      // from {@link ALLOWED_TURN_TIMERS}).
      tx.expire(key, 60 * 60 * 24);
      await tx.exec();
    } catch (err) {
      this.logger.warn({ err, gameId }, 'turn-timer write failed');
    }
  }

  private armTimer(gameId: string, delayMs: number): void {
    this.cancelTimer(gameId);
    const t = setTimeout(() => {
      this.timers.delete(gameId);
      // The bus is the gateway, which will re-enter `GamesService` under its
      // own per-game lock. We don't await here so the timer thread isn't
      // blocked by a Postgres finalize on a game-over edge case.
      void Promise.resolve(this.bus.onExpired(gameId)).catch((err) => {
        this.logger.warn({ err, gameId }, 'turn-timer expiry handler failed');
      });
    }, delayMs);
    if (typeof (t as { unref?: () => void }).unref === 'function') {
      (t as { unref?: () => void }).unref!();
    }
    this.timers.set(gameId, t);
  }

  private cancelTimer(gameId: string): void {
    const t = this.timers.get(gameId);
    if (t) {
      clearTimeout(t);
      this.timers.delete(gameId);
    }
  }
}
