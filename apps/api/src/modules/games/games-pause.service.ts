import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { GameState } from '@durak/game-engine';
import {
  PAUSE_DISCONNECT_GRACE_SECONDS,
  type PauseInfo,
  type PauseVote,
} from '@durak/shared-types';
import { RedisService } from '../../infrastructure/redis/redis.service';

/** Redis key suffix for the per-game pause meta-state. */
export const GAME_PAUSE_SUFFIX = ':pause';

/** Redis prefix for the per-game pause-mutation lock. Distinct from
 *  `game-lock:` so it never conflicts with `GamesService.withLock` — a pause
 *  mutation MUST be safe to run from inside or outside the engine-level lock
 *  (e.g. `concedeGame` already holds the engine lock and then clears pause). */
const PAUSE_LOCK_KEY_PREFIX = 'pause-lock:';
const PAUSE_LOCK_TTL_MS = 5_000;
const PAUSE_LOCK_MAX_ATTEMPTS = 50;
const PAUSE_LOCK_RETRY_DELAY_MS = 20;

function pauseKey(gameId: string): string {
  return `game:${gameId}${GAME_PAUSE_SUFFIX}`;
}

function pauseLockKey(gameId: string): string {
  return `${PAUSE_LOCK_KEY_PREFIX}${gameId}`;
}

function generateLockToken(): string {
  return randomBytes(12).toString('base64url');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PauseVoteTally {
  /** Decision after the vote closed. `null` when the vote still has open seats. */
  decision: 'wait_more' | 'concede' | null;
  /** Final vote tally for the broadcast. */
  votes: Record<string, PauseVote>;
}

/**
 * Disconnect-pause / concede-vote state machine, persisted in Redis. Lives
 * separately from the engine so we don't pollute the pure reducer with
 * meta-state about user sessions. Timers themselves are owned by the gateway
 * (in-memory) — this service is the persistence + decision layer only.
 *
 * Schema (`game:<id>:pause`) is a single JSON blob shaped like {@link PauseInfo}.
 * Created lazily on the first disconnect, removed when:
 *   - every disconnected user reconnects, or
 *   - the vote tally decides `concede` (game ends), or
 *   - the game finishes for any other reason.
 */
@Injectable()
export class GamesPauseService {
  private readonly logger = new Logger(GamesPauseService.name);

  constructor(private readonly redis: RedisService) {}

  // -------- read --------

  async get(gameId: string): Promise<PauseInfo | null> {
    const raw = await this.redis.client.get(pauseKey(gameId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PauseInfo;
    } catch {
      // Corrupted — drop it and start fresh so the game isn't perpetually
      // locked by a bad blob.
      await this.redis.client.del(pauseKey(gameId)).catch(() => undefined);
      return null;
    }
  }

  /**
   * Mark a user as disconnected. Creates the pause record if absent, or merges
   * the user into the existing `disconnectedUserIds` list. The grace timeout
   * is anchored to the FIRST disconnect — i.e. a second drop-out doesn't reset
   * the clock. Returns the resulting {@link PauseInfo} so the caller can
   * broadcast / schedule a timer.
   */
  async markDisconnected(gameId: string, userId: string): Promise<PauseInfo> {
    return this.withLock(gameId, async () => {
      const now = new Date();
      const existing = await this.get(gameId);
      if (existing) {
        if (existing.disconnectedUserIds.includes(userId)) return existing;
        const next: PauseInfo = {
          ...existing,
          disconnectedUserIds: [...existing.disconnectedUserIds, userId],
        };
        await this.write(gameId, next);
        return next;
      }
      const pausedAtMs = now.getTime();
      const timeoutAtMs = pausedAtMs + PAUSE_DISCONNECT_GRACE_SECONDS * 1000;
      const next: PauseInfo = {
        disconnectedUserIds: [userId],
        pausedAt: new Date(pausedAtMs).toISOString(),
        timeoutAt: new Date(timeoutAtMs).toISOString(),
        voteOpen: false,
        voteOpenedAt: null,
        votes: {},
      };
      await this.write(gameId, next);
      return next;
    });
  }

  /**
   * Mark a user as reconnected. Returns the resulting {@link PauseInfo} (or
   * null if the pause was cleared entirely because everybody is back).
   *
   * Side effect: when a reconnect happens DURING an open vote, the user's
   * previously-cast vote (if any) is wiped — they returned, they shouldn't
   * pre-decide what the remaining voters do.
   */
  async markReconnected(gameId: string, userId: string): Promise<PauseInfo | null> {
    return this.withLock(gameId, async () => {
      const existing = await this.get(gameId);
      if (!existing) return null;
      if (!existing.disconnectedUserIds.includes(userId)) return existing;
      const remaining = existing.disconnectedUserIds.filter((id) => id !== userId);
      if (remaining.length === 0) {
        await this.clearUnlocked(gameId);
        return null;
      }
      // Strip this user's vote (they're back; their voice as a "disconnected"
      // doesn't count, and they don't vote as an active either — they just left
      // the vote pool).
      const votes = { ...existing.votes };
      delete votes[userId];
      const next: PauseInfo = {
        ...existing,
        disconnectedUserIds: remaining,
        votes,
      };
      await this.write(gameId, next);
      return next;
    });
  }

  /**
   * Flip the vote window open. Idempotent: if it's already open we return the
   * current state. Triggered by the gateway when the grace timer fires.
   */
  async openVote(gameId: string): Promise<PauseInfo | null> {
    return this.withLock(gameId, async () => {
      const existing = await this.get(gameId);
      if (!existing) return null;
      if (existing.voteOpen) return existing;
      const next: PauseInfo = {
        ...existing,
        voteOpen: true,
        voteOpenedAt: new Date().toISOString(),
        votes: {},
      };
      await this.write(gameId, next);
      return next;
    });
  }

  /**
   * Record a vote from an active player. Returns `null` if the vote isn't
   * open, the voter isn't allowed (e.g. they're one of the disconnected), or
   * the vote was already counted. Otherwise returns the updated state.
   */
  async castVote(gameId: string, voterId: string, vote: PauseVote): Promise<PauseInfo | null> {
    return this.withLock(gameId, async () => {
      const existing = await this.get(gameId);
      if (!existing || !existing.voteOpen) return null;
      if (existing.disconnectedUserIds.includes(voterId)) return null;
      const votes = { ...existing.votes, [voterId]: vote };
      const next: PauseInfo = { ...existing, votes };
      await this.write(gameId, next);
      return next;
    });
  }

  /**
   * Tally votes given the set of eligible voters (active, connected, in-game
   * players). Returns a `decision` of `concede` if a strict majority of votes
   * are 'concede', `wait_more` if a strict majority are 'wait_more', and
   * `null` while not every eligible voter has cast a ballot.
   *
   * "All votes cast" is the trigger — partial tallies leave the vote open so
   * a late voter still matters. Ties (only possible at even voter counts)
   * default to `wait_more` (give the disconnected player another chance).
   */
  tally(info: PauseInfo, eligibleVoterIds: string[]): PauseVoteTally {
    const votes = info.votes;
    const cast = eligibleVoterIds.filter((id) => votes[id] !== undefined);
    if (cast.length < eligibleVoterIds.length || eligibleVoterIds.length === 0) {
      return { decision: null, votes };
    }
    let concede = 0;
    let wait = 0;
    for (const id of cast) {
      if (votes[id] === 'concede') concede++;
      else if (votes[id] === 'wait_more') wait++;
    }
    if (concede > wait) return { decision: 'concede', votes };
    return { decision: 'wait_more', votes };
  }

  /**
   * Reset the timer on `wait_more` wins: clears votes, closes the vote window
   * and bumps `timeoutAt` to now + grace. Returns the updated state.
   */
  async extendWait(gameId: string): Promise<PauseInfo | null> {
    return this.withLock(gameId, async () => {
      const existing = await this.get(gameId);
      if (!existing) return null;
      const now = Date.now();
      const next: PauseInfo = {
        ...existing,
        pausedAt: new Date(now).toISOString(),
        timeoutAt: new Date(now + PAUSE_DISCONNECT_GRACE_SECONDS * 1000).toISOString(),
        voteOpen: false,
        voteOpenedAt: null,
        votes: {},
      };
      await this.write(gameId, next);
      return next;
    });
  }

  async clear(gameId: string): Promise<void> {
    await this.clearUnlocked(gameId);
  }

  /** Internal: bypasses the pause-mutation lock. Used by code paths that already
   *  hold it (e.g. {@link markReconnected}). Callers outside the lock should use
   *  the public {@link clear}. */
  private async clearUnlocked(gameId: string): Promise<void> {
    await this.redis.client.del(pauseKey(gameId)).catch(() => undefined);
  }

  /**
   * List every game id that currently has a pause record. Used at boot to
   * resurrect in-memory timers after an api restart.
   */
  async listPaused(): Promise<string[]> {
    try {
      const keys = await this.redis.client.keys(`game:*${GAME_PAUSE_SUFFIX}`);
      const out: string[] = [];
      for (const k of keys) {
        // `game:<id>:pause` — strip prefix + suffix.
        const id = k.slice('game:'.length, k.length - GAME_PAUSE_SUFFIX.length);
        if (id) out.push(id);
      }
      return out;
    } catch (err) {
      this.logger.warn({ err }, 'listPaused: SCAN failed');
      return [];
    }
  }

  /**
   * Helper: the set of voters that should be counted when tallying. Players
   * who are disconnected, finished, or simply absent from the game don't get
   * a vote. The gateway supplies the live connected-user set; we filter that
   * against engine state.
   */
  eligibleVoters(state: GameState, info: PauseInfo, connectedUserIds: string[]): string[] {
    const disconnected = new Set(info.disconnectedUserIds);
    const finished = new Set(state.finishedPlayers);
    const connected = new Set(connectedUserIds);
    const out: string[] = [];
    for (const p of state.players) {
      if (disconnected.has(p.id)) continue;
      if (finished.has(p.id)) continue;
      if (!connected.has(p.id)) continue;
      out.push(p.id);
    }
    return out;
  }

  // -------- internals --------

  private async write(gameId: string, info: PauseInfo): Promise<void> {
    // The pause blob piggybacks on the game's TTL: 24 h is wildly more than
    // we'd ever need, and it gets actively cleared on the vote/reconnect/game-
    // over hooks anyway.
    await this.redis.client.set(pauseKey(gameId), JSON.stringify(info), 'EX', 60 * 60 * 24);
  }

  /**
   * Per-game mutex for pause-state mutations. Distinct from
   * `GamesService.withLock` (which guards engine state) so the two never
   * deadlock — `concedeGame` already holds the engine lock and then calls
   * `pause.clear`. Mirrors the `SET NX PX` pattern used elsewhere in the codebase.
   */
  private async withLock<T>(gameId: string, fn: () => Promise<T>): Promise<T> {
    const token = generateLockToken();
    const key = pauseLockKey(gameId);
    let acquired = false;
    for (let i = 0; i < PAUSE_LOCK_MAX_ATTEMPTS; i++) {
      const res = await this.redis.client.set(key, token, 'PX', PAUSE_LOCK_TTL_MS, 'NX');
      if (res === 'OK') {
        acquired = true;
        break;
      }
      await sleep(PAUSE_LOCK_RETRY_DELAY_MS);
    }
    if (!acquired) {
      // The lock TTL is short and contention should be rare (only competing
      // disconnect/reconnect/vote events from the same game). If we ever DO
      // exhaust attempts, run the inner block anyway: we'd rather risk a rare
      // overwrite than throw and freeze the pause state machine.
      this.logger.warn({ gameId }, 'pause lock contention exceeded; proceeding without lock');
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
