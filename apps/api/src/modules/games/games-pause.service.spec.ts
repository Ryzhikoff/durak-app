import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GameState } from '@durak/game-engine';
import { PAUSE_DISCONNECT_GRACE_SECONDS, type PauseInfo } from '@durak/shared-types';
import { GAME_PAUSE_SUFFIX, GamesPauseService } from './games-pause.service';

/**
 * Minimal in-memory Redis fake covering just what the pause service touches
 * (get/set/del/keys). Mirrors the helper used in games.service.spec.ts so
 * tests can be read side-by-side.
 */
class FakeRedis {
  store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string, ...rest: unknown[]): Promise<'OK' | null> {
    // Respect SET NX semantics so the pause-lock under test behaves like real
    // Redis (returns null when the key is already taken).
    if (rest.includes('NX') && this.store.has(key)) return null;
    this.store.set(key, value);
    return 'OK';
  }
  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) if (this.store.delete(k)) n++;
    return n;
  }
  async keys(pattern: string): Promise<string[]> {
    // Convert the simple `game:*:pause` glob to a regex. Good enough for tests.
    const re = new RegExp(
      '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    );
    return [...this.store.keys()].filter((k) => re.test(k));
  }
  // The pause-lock helper uses `eval` to release the lock atomically. Mirrors
  // the simple CAS-and-DEL semantics of the production Lua script.
  async eval(_script: string, _numKeys: number, key: string, arg: string): Promise<number> {
    if (this.store.get(key) === arg) {
      this.store.delete(key);
      return 1;
    }
    return 0;
  }
}

function makeService(redis: FakeRedis): GamesPauseService {
  return new GamesPauseService({ client: redis } as unknown as never);
}

function pauseKey(gameId: string): string {
  return `game:${gameId}${GAME_PAUSE_SUFFIX}`;
}

const GAME_ID = 'g1';

describe('GamesPauseService', () => {
  let redis: FakeRedis;
  let svc: GamesPauseService;

  beforeEach(() => {
    redis = new FakeRedis();
    svc = makeService(redis);
  });

  describe('markDisconnected', () => {
    it('creates the pause record on the first disconnect', async () => {
      const info = await svc.markDisconnected(GAME_ID, 'ua');
      expect(info.disconnectedUserIds).toEqual(['ua']);
      expect(info.voteOpen).toBe(false);
      expect(info.voteOpenedAt).toBeNull();
      expect(info.votes).toEqual({});
      // timeoutAt is anchored to the moment we created it.
      const delta = new Date(info.timeoutAt).getTime() - new Date(info.pausedAt).getTime();
      expect(delta).toBe(PAUSE_DISCONNECT_GRACE_SECONDS * 1000);
      // Persisted to Redis under the canonical key.
      const raw = await redis.get(pauseKey(GAME_ID));
      expect(raw).toBeTruthy();
    });

    it('merges a second disconnect without resetting the timer', async () => {
      const first = await svc.markDisconnected(GAME_ID, 'ua');
      // Slight delay so any reset bug would be observable.
      await new Promise((r) => setTimeout(r, 5));
      const merged = await svc.markDisconnected(GAME_ID, 'ub');
      expect(merged.disconnectedUserIds).toEqual(['ua', 'ub']);
      expect(merged.pausedAt).toBe(first.pausedAt);
      expect(merged.timeoutAt).toBe(first.timeoutAt);
    });

    it('is idempotent for the same user', async () => {
      await svc.markDisconnected(GAME_ID, 'ua');
      const again = await svc.markDisconnected(GAME_ID, 'ua');
      expect(again.disconnectedUserIds).toEqual(['ua']);
    });

    it('serialises concurrent markDisconnected calls — no lost writes', async () => {
      // Two disconnects fired truly in parallel without the per-game pause
      // lock would race on the read-modify-write cycle: both reads see the
      // empty state, both writes create a fresh blob, the last one wins and
      // the other id is silently dropped. The lock guarantees both end up in
      // the disconnected list regardless of who got scheduled first.
      const [a, b] = await Promise.all([
        svc.markDisconnected(GAME_ID, 'ua'),
        svc.markDisconnected(GAME_ID, 'ub'),
      ]);
      // Each call returns the snapshot it produced; the FINAL persisted state
      // must contain both regardless of which call wrote last.
      const final = await svc.get(GAME_ID);
      expect(final).not.toBeNull();
      expect(new Set(final!.disconnectedUserIds)).toEqual(new Set(['ua', 'ub']));
      // The first writer's payload is a single-id list, the second is the
      // merged list — but both must include their own user id at minimum.
      expect(a.disconnectedUserIds).toContain('ua');
      expect(b.disconnectedUserIds).toContain('ub');
    });
  });

  describe('markReconnected', () => {
    it('removes the user from the disconnected list', async () => {
      await svc.markDisconnected(GAME_ID, 'ua');
      await svc.markDisconnected(GAME_ID, 'ub');
      const after = await svc.markReconnected(GAME_ID, 'ua');
      expect(after?.disconnectedUserIds).toEqual(['ub']);
    });

    it('clears the pause entirely when the last user reconnects', async () => {
      await svc.markDisconnected(GAME_ID, 'ua');
      const after = await svc.markReconnected(GAME_ID, 'ua');
      expect(after).toBeNull();
      // Redis blob is also gone.
      expect(await redis.get(pauseKey(GAME_ID))).toBeNull();
    });

    it("drops the returning user's vote when reconnecting mid-vote", async () => {
      await svc.markDisconnected(GAME_ID, 'ua');
      await svc.markDisconnected(GAME_ID, 'ub');
      await svc.openVote(GAME_ID);
      await svc.castVote(GAME_ID, 'uc', 'wait_more');
      const after = await svc.markReconnected(GAME_ID, 'ua');
      // The reconnecting user wasn't a voter (they were disconnected). The
      // voter's ballot survives.
      expect(after?.votes).toEqual({ uc: 'wait_more' });
    });

    it("returns the existing state when the user wasn't marked disconnected", async () => {
      await svc.markDisconnected(GAME_ID, 'ua');
      const result = await svc.markReconnected(GAME_ID, 'someone-else');
      expect(result?.disconnectedUserIds).toEqual(['ua']);
    });
  });

  describe('openVote / castVote / tally', () => {
    it('opens the vote idempotently', async () => {
      await svc.markDisconnected(GAME_ID, 'ua');
      const open1 = await svc.openVote(GAME_ID);
      expect(open1?.voteOpen).toBe(true);
      expect(open1?.voteOpenedAt).not.toBeNull();
      const open2 = await svc.openVote(GAME_ID);
      // Doesn't re-stamp voteOpenedAt or clear votes.
      expect(open2?.voteOpenedAt).toBe(open1?.voteOpenedAt);
    });

    it('refuses votes when no vote is open', async () => {
      await svc.markDisconnected(GAME_ID, 'ua');
      const res = await svc.castVote(GAME_ID, 'ub', 'wait_more');
      expect(res).toBeNull();
    });

    it('refuses votes from disconnected users', async () => {
      await svc.markDisconnected(GAME_ID, 'ua');
      await svc.openVote(GAME_ID);
      const res = await svc.castVote(GAME_ID, 'ua', 'concede');
      expect(res).toBeNull();
    });

    it('returns null decision when not every eligible voter has cast', async () => {
      await svc.markDisconnected(GAME_ID, 'ua');
      const info = (await svc.openVote(GAME_ID)) as PauseInfo;
      const updated = (await svc.castVote(GAME_ID, 'ub', 'wait_more')) as PauseInfo;
      const tally = svc.tally(updated, ['ub', 'uc']);
      expect(tally.decision).toBeNull();
      expect(info.disconnectedUserIds).toEqual(['ua']);
    });

    it('decides wait_more on a majority of wait_more votes', async () => {
      await svc.markDisconnected(GAME_ID, 'ua');
      await svc.openVote(GAME_ID);
      await svc.castVote(GAME_ID, 'ub', 'wait_more');
      const info = (await svc.castVote(GAME_ID, 'uc', 'concede')) as PauseInfo;
      const tally = svc.tally(info, ['ub', 'uc']);
      // 1-1 tie: wait_more wins (default to give the disconnected a chance).
      expect(tally.decision).toBe('wait_more');
    });

    it('decides concede when concede has a strict majority', async () => {
      await svc.markDisconnected(GAME_ID, 'ua');
      await svc.openVote(GAME_ID);
      await svc.castVote(GAME_ID, 'ub', 'concede');
      await svc.castVote(GAME_ID, 'uc', 'concede');
      const info = (await svc.castVote(GAME_ID, 'ud', 'wait_more')) as PauseInfo;
      const tally = svc.tally(info, ['ub', 'uc', 'ud']);
      expect(tally.decision).toBe('concede');
    });
  });

  describe('extendWait', () => {
    it('resets timer, closes vote, and clears votes', async () => {
      await svc.markDisconnected(GAME_ID, 'ua');
      await svc.openVote(GAME_ID);
      await svc.castVote(GAME_ID, 'ub', 'wait_more');
      const extended = (await svc.extendWait(GAME_ID)) as PauseInfo;
      expect(extended.voteOpen).toBe(false);
      expect(extended.voteOpenedAt).toBeNull();
      expect(extended.votes).toEqual({});
      const delta = new Date(extended.timeoutAt).getTime() - new Date(extended.pausedAt).getTime();
      expect(delta).toBe(PAUSE_DISCONNECT_GRACE_SECONDS * 1000);
    });
  });

  describe('listPaused', () => {
    it('returns every game id with a pause record', async () => {
      await svc.markDisconnected('g1', 'ua');
      await svc.markDisconnected('g2', 'uz');
      const ids = (await svc.listPaused()).sort();
      expect(ids).toEqual(['g1', 'g2']);
    });

    it('returns an empty array when no games are paused', async () => {
      const ids = await svc.listPaused();
      expect(ids).toEqual([]);
    });
  });

  describe('eligibleVoters', () => {
    function makeState(playerIds: string[], finished: string[] = []): GameState {
      return {
        players: playerIds.map((id) => ({ id, nickname: id, hand: [] })),
        finishedPlayers: finished,
      } as unknown as GameState;
    }

    it('excludes disconnected, finished, and offline seats', async () => {
      await svc.markDisconnected(GAME_ID, 'ua');
      const info = (await svc.get(GAME_ID)) as PauseInfo;
      const state = makeState(['ua', 'ub', 'uc', 'ud'], ['uc']);
      const eligible = svc.eligibleVoters(state, info, ['ub', 'ud']);
      // ua disconnected, uc finished, ud connected so kept.
      expect(eligible.sort()).toEqual(['ub', 'ud']);
    });

    it('returns an empty array when nobody is connected', async () => {
      await svc.markDisconnected(GAME_ID, 'ua');
      const info = (await svc.get(GAME_ID)) as PauseInfo;
      const state = makeState(['ua', 'ub']);
      expect(svc.eligibleVoters(state, info, [])).toEqual([]);
    });
  });
});

describe('GamesPauseService corruption handling', () => {
  it('drops corrupted blobs and returns null', async () => {
    const redis = new FakeRedis();
    await redis.set(pauseKey(GAME_ID), 'not-json');
    const svc = makeService(redis);
    const info = await svc.get(GAME_ID);
    expect(info).toBeNull();
    expect(await redis.get(pauseKey(GAME_ID))).toBeNull();
  });

  it('survives Redis errors on listPaused', async () => {
    const redis = {
      keys: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const svc = new GamesPauseService({ client: redis } as unknown as never);
    expect(await svc.listPaused()).toEqual([]);
  });
});
