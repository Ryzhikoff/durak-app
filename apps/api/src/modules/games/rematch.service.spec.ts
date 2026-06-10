import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_LOBBY_SETTINGS,
  REMATCH_SESSION_TTL_SECONDS,
  REMATCH_WINDOW_MINUTES,
  type GameDetail,
  type LobbySettings,
  type RematchCancelReason,
  type RematchSession,
} from '@durak/shared-types';
import { RematchService, REMATCH_KEY_PREFIX } from './rematch.service';
import type { GamesHistoryService } from './games-history.service';
import type { GamesService } from './games.service';
import type { ShuffleFn } from '../../common/shuffle';

/**
 * Identity shuffle — preserves order. Used so the bulk of existing assertions
 * stay deterministic. Tests that specifically exercise the random-layout
 * branch override this with their own deterministic stand-in.
 */
const identityShuffle: ShuffleFn = <T>(items: readonly T[]): T[] => items.slice();

/**
 * In-memory Redis fake. We only implement the surface RematchService actually
 * touches: GET / SET (incl. NX) / DEL / KEYS / EVAL (CAS lock release).
 */
class FakeRedis {
  store = new Map<string, string>();
  expiry = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  async set(key: string, value: string, ...rest: unknown[]): Promise<'OK' | null> {
    if (rest.includes('NX') && this.store.has(key)) {
      return null;
    }
    this.store.set(key, value);
    // Look for EX / PX so the TTL fakes are honoured.
    const exIdx = rest.indexOf('EX');
    const pxIdx = rest.indexOf('PX');
    if (exIdx !== -1 && typeof rest[exIdx + 1] === 'number') {
      this.expiry.set(key, Date.now() + (rest[exIdx + 1] as number) * 1000);
    } else if (pxIdx !== -1 && typeof rest[pxIdx + 1] === 'number') {
      this.expiry.set(key, Date.now() + (rest[pxIdx + 1] as number));
    } else {
      this.expiry.delete(key);
    }
    return 'OK';
  }
  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.store.delete(k)) n++;
      this.expiry.delete(k);
    }
    return n;
  }
  async keys(pattern: string): Promise<string[]> {
    // Trivial `prefix*` matcher — enough for our resumeTimers SCAN.
    const star = pattern.indexOf('*');
    if (star === -1) {
      return this.store.has(pattern) ? [pattern] : [];
    }
    const prefix = pattern.slice(0, star);
    return [...this.store.keys()].filter((k) => k.startsWith(prefix));
  }
  async eval(_script: string, _numKeys: number, key: string, arg: string): Promise<number> {
    if (this.store.get(key) === arg) {
      this.store.delete(key);
      return 1;
    }
    return 0;
  }
}

function makeDetail(overrides: Partial<GameDetail> = {}): GameDetail {
  const settings: LobbySettings = { ...DEFAULT_LOBBY_SETTINGS, turnTimer: 60 };
  return {
    id: 'g-1',
    settings,
    startedAt: '2026-06-05T10:00:00.000Z',
    finishedAt: new Date().toISOString(),
    durationSec: 600,
    loserId: 'uc',
    totalBouts: 8,
    participants: [
      makeParticipant('ua', 'Alice', 0, 1, true, false),
      makeParticipant('ub', 'Bob', 1, 2, false, false),
      makeParticipant('uc', 'Carol', 2, 3, false, true),
    ],
    ...overrides,
  };
}

function makeParticipant(
  userId: string,
  nickname: string,
  seatIndex: number,
  place: number,
  isWinner: boolean,
  isLoser: boolean,
): GameDetail['participants'][number] {
  return {
    userId,
    nickname,
    avatarUrl: null,
    seatIndex,
    place,
    isWinner,
    isLoser,
    muBefore: 25,
    sigmaBefore: 8,
    muAfter: 25,
    sigmaAfter: 8,
    deltaDisplay: 0,
    metrics: {
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
    },
  };
}

function makeService(opts?: {
  detail?: GameDetail | null;
  detailById?: Record<string, GameDetail>;
  createFromComposition?: (input: unknown) => Promise<{ gameId: string }>;
  shuffle?: ShuffleFn;
}): {
  svc: RematchService;
  redis: FakeRedis;
  bus: {
    invited: ReturnType<typeof vi.fn>;
    updated: ReturnType<typeof vi.fn>;
    started: ReturnType<typeof vi.fn>;
    cancelled: ReturnType<typeof vi.fn>;
  };
  history: Partial<GamesHistoryService>;
  games: Partial<GamesService>;
} {
  const redis = new FakeRedis();
  const detail = opts?.detail ?? makeDetail();
  const detailById = opts?.detailById ?? (detail ? { [detail.id]: detail } : {});
  const history: Partial<GamesHistoryService> = {
    getDetail: vi.fn(async (id: string) => detailById[id] ?? null),
  };
  const games = {
    createFromComposition:
      opts?.createFromComposition ??
      vi.fn(async () => ({ gameId: `new-${Math.random().toString(36).slice(2, 8)}` })),
  } as unknown as Partial<GamesService>;
  // Default to identity-shuffle so legacy assertions stay deterministic. The
  // layoutOnRepeat tests below override this with their own stand-in.
  const shuffle = opts?.shuffle ?? identityShuffle;
  const svc = new RematchService(
    { client: redis } as unknown as never,
    games as unknown as GamesService,
    history as unknown as GamesHistoryService,
    shuffle,
  );
  const bus = {
    invited: vi.fn(),
    updated: vi.fn(),
    started: vi.fn(),
    cancelled: vi.fn(),
  };
  svc.setEventBus(bus);
  return { svc, redis, bus, history, games };
}

describe('RematchService.initiateOrAccept (create path)', () => {
  it('creates a session and broadcasts invited to OTHER participants only', async () => {
    const { svc, redis, bus } = makeService();
    const session = await svc.initiateOrAccept('ua', 'g-1');
    expect(session.sourceGameId).toBe('g-1');
    expect(session.initiator.userId).toBe('ua');
    expect(session.expectedUserIds).toEqual(['ua', 'ub', 'uc']);
    expect(session.accepted).toEqual(['ua']);
    expect(session.settings.turnTimer).toBe(60);
    expect(session.composition).toEqual(['ua', 'ub', 'uc']);
    expect(session.participants.map((p) => p.userId)).toEqual(['ua', 'ub', 'uc']);
    // Persisted in Redis.
    expect(await redis.get(`${REMATCH_KEY_PREFIX}g-1`)).toBeTruthy();
    // Broadcast went to ub + uc (not ua).
    expect(bus.invited).toHaveBeenCalledTimes(1);
    expect(bus.invited.mock.calls[0][0]).toEqual(['ub', 'uc']);
    expect(bus.invited.mock.calls[0][1]).toMatchObject({ sourceGameId: 'g-1' });
    expect(bus.updated).not.toHaveBeenCalled();
    expect(bus.started).not.toHaveBeenCalled();
  });

  it('rejects with NOT_A_PARTICIPANT when caller did not play', async () => {
    const { svc } = makeService();
    await expect(svc.initiateOrAccept('intruder', 'g-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects with GAME_NOT_FOUND when the source game is unknown', async () => {
    const { svc } = makeService({ detail: null });
    await expect(svc.initiateOrAccept('ua', 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects with REMATCH_WINDOW_CLOSED when the source game finished too long ago', async () => {
    const stale = new Date(Date.now() - (REMATCH_WINDOW_MINUTES + 5) * 60 * 1000).toISOString();
    const { svc } = makeService({ detail: makeDetail({ finishedAt: stale }) });
    await expect(svc.initiateOrAccept('ua', 'g-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REMATCH_WINDOW_CLOSED' }),
    });
  });

  it('coalesces three concurrent initiates into a single session', async () => {
    const createFromComposition = vi.fn(async () => ({ gameId: 'new-game' }));
    const { svc, redis, bus } = makeService({ createFromComposition });
    const results = await Promise.all([
      svc.initiateOrAccept('ua', 'g-1'),
      svc.initiateOrAccept('ub', 'g-1'),
      svc.initiateOrAccept('uc', 'g-1'),
    ]);
    // The session blob should be the same id for all three callers — only one
    // session exists in Redis. (We assert this implicitly by checking
    // sourceGameId equality and that the bus only ever saw one "invited" fan.)
    expect(results.every((r) => r.sourceGameId === 'g-1')).toBe(true);
    expect(bus.invited).toHaveBeenCalledTimes(1);
    // After all three accepted, the session should be removed and the game
    // created exactly once.
    expect(createFromComposition).toHaveBeenCalledTimes(1);
    expect(await redis.get(`${REMATCH_KEY_PREFIX}g-1`)).toBeNull();
    expect(bus.started).toHaveBeenCalledTimes(1);
    expect(bus.started.mock.calls[0][1]).toEqual({
      sourceGameId: 'g-1',
      newGameId: 'new-game',
    });
  });
});

describe('RematchService.accept', () => {
  it('idempotent: returns the same session if the caller already accepted', async () => {
    const { svc, bus } = makeService();
    await svc.initiateOrAccept('ua', 'g-1');
    const reAccepted = await svc.accept('ua', 'g-1');
    expect(reAccepted.accepted).toEqual(['ua']);
    // No extra broadcast for an idempotent accept.
    expect(bus.updated).not.toHaveBeenCalled();
  });

  it('broadcasts updated to all expected users when a new accept lands', async () => {
    const { svc, bus } = makeService();
    await svc.initiateOrAccept('ua', 'g-1');
    const next = await svc.accept('ub', 'g-1');
    expect(next.accepted).toEqual(['ua', 'ub']);
    expect(bus.updated).toHaveBeenCalledTimes(1);
    expect(bus.updated.mock.calls[0][0]).toEqual(['ua', 'ub', 'uc']);
  });

  it('reaches quorum -> spawns the new game and broadcasts started', async () => {
    const createFromComposition = vi.fn(async (_input: unknown) => ({
      gameId: 'newg-1',
    }));
    const { svc, redis, bus } = makeService({ createFromComposition });
    await svc.initiateOrAccept('ua', 'g-1');
    await svc.accept('ub', 'g-1');
    await svc.accept('uc', 'g-1');
    expect(createFromComposition).toHaveBeenCalledTimes(1);
    const callArg = createFromComposition.mock.calls[0][0] as {
      players: Array<{ userId: string }>;
      previousLoserId: string | null;
      settings: LobbySettings;
    };
    expect(callArg.players.map((p) => p.userId)).toEqual(['ua', 'ub', 'uc']);
    expect(callArg.previousLoserId).toBe('uc');
    expect(callArg.settings.turnTimer).toBe(60);
    expect(bus.started).toHaveBeenCalledTimes(1);
    expect(bus.started.mock.calls[0][1]).toEqual({
      sourceGameId: 'g-1',
      newGameId: 'newg-1',
    });
    // Session is gone after start.
    expect(await redis.get(`${REMATCH_KEY_PREFIX}g-1`)).toBeNull();
  });

  it('rejects accept on missing session with REMATCH_NOT_FOUND (404)', async () => {
    const { svc } = makeService();
    await expect(svc.accept('ua', 'g-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects accept with NOT_A_PARTICIPANT when caller is not in the expected list', async () => {
    const { svc } = makeService();
    await svc.initiateOrAccept('ua', 'g-1');
    await expect(svc.accept('intruder', 'g-1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('RematchService.cancel', () => {
  it('removes the session and broadcasts cancelled (declined)', async () => {
    const { svc, redis, bus } = makeService();
    await svc.initiateOrAccept('ua', 'g-1');
    await svc.cancel('ub', 'g-1', 'declined');
    expect(await redis.get(`${REMATCH_KEY_PREFIX}g-1`)).toBeNull();
    expect(bus.cancelled).toHaveBeenCalledTimes(1);
    expect(bus.cancelled.mock.calls[0][1]).toEqual({
      sourceGameId: 'g-1',
      reason: 'declined' satisfies RematchCancelReason,
    });
  });

  it('no-op when the session is already gone', async () => {
    const { svc, bus } = makeService();
    await svc.cancel('ua', 'g-1');
    expect(bus.cancelled).not.toHaveBeenCalled();
  });

  it('rejects when caller is not in the expectedUserIds list', async () => {
    const { svc } = makeService();
    await svc.initiateOrAccept('ua', 'g-1');
    await expect(svc.cancel('intruder', 'g-1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('RematchService TTL expiry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('auto-cancels after REMATCH_SESSION_TTL_SECONDS with reason=expired', async () => {
    const { svc, redis, bus } = makeService();
    await svc.initiateOrAccept('ua', 'g-1');
    // Advance virtual time past the TTL window.
    await vi.advanceTimersByTimeAsync(REMATCH_SESSION_TTL_SECONDS * 1000 + 50);
    expect(await redis.get(`${REMATCH_KEY_PREFIX}g-1`)).toBeNull();
    expect(bus.cancelled).toHaveBeenCalledTimes(1);
    expect(bus.cancelled.mock.calls[0][1]).toMatchObject({
      sourceGameId: 'g-1',
      reason: 'expired',
    });
    vi.useRealTimers();
  });
});

describe('RematchService spawn failure', () => {
  it('tears down the session, broadcasts spawn_failed, and re-throws when createFromComposition rejects', async () => {
    const boom = new Error('postgres flake');
    const createFromComposition = vi.fn(async () => {
      throw boom;
    });
    const { svc, redis, bus } = makeService({ createFromComposition });
    await svc.initiateOrAccept('ua', 'g-1');
    await svc.accept('ub', 'g-1');
    // Final accept hits quorum -> spawn -> blows up. The error should
    // propagate to the HTTP layer so the caller knows their request failed.
    await expect(svc.accept('uc', 'g-1')).rejects.toBe(boom);
    // Session key must be gone — otherwise the zombie sits in Redis until
    // the natural TTL (90s) and freezes everyone else's modal.
    expect(await redis.get(`${REMATCH_KEY_PREFIX}g-1`)).toBeNull();
    // Every participant must learn the rematch is dead via WS.
    expect(bus.cancelled).toHaveBeenCalledTimes(1);
    expect(bus.cancelled.mock.calls[0][0]).toEqual(['ua', 'ub', 'uc']);
    expect(bus.cancelled.mock.calls[0][1]).toEqual({
      sourceGameId: 'g-1',
      reason: 'spawn_failed' satisfies RematchCancelReason,
    });
    // We never broadcast a phantom `started`.
    expect(bus.started).not.toHaveBeenCalled();
    // peek should agree the session is dead.
    expect(await svc.peek('g-1')).toBeNull();
  });
});

describe('RematchService.peek', () => {
  it('exposes the live session for the gateway hot-path', async () => {
    const { svc } = makeService();
    await svc.initiateOrAccept('ua', 'g-1');
    const session = await svc.peek('g-1');
    expect(session).not.toBeNull();
    expect((session as RematchSession).expectedUserIds).toEqual(['ua', 'ub', 'uc']);
  });
});

describe('RematchService layoutOnRepeat', () => {
  it('random: feeds the shuffled seat order into createFromComposition', async () => {
    // Pin a deterministic "shuffle" (reverse) so we can assert the exact order
    // that lands in createFromComposition without depending on the RNG.
    // The `as unknown as ShuffleFn` cast is needed because `vi.fn` collapses
    // the generic; the runtime behaviour is what we care about.
    const shuffleSpy = vi.fn((items: readonly unknown[]) => items.slice().reverse());
    const createFromComposition = vi.fn(async (_input: unknown) => ({
      gameId: 'newg-rand',
    }));
    const detail = makeDetail({
      settings: { ...DEFAULT_LOBBY_SETTINGS, layoutOnRepeat: 'random' },
    });
    const { svc } = makeService({
      detail,
      createFromComposition,
      shuffle: shuffleSpy as unknown as ShuffleFn,
    });

    await svc.initiateOrAccept('ua', 'g-1');
    await svc.accept('ub', 'g-1');
    await svc.accept('uc', 'g-1');

    expect(shuffleSpy).toHaveBeenCalledTimes(1);
    expect(createFromComposition).toHaveBeenCalledTimes(1);
    const callArg = createFromComposition.mock.calls[0][0] as {
      players: Array<{ userId: string }>;
    };
    // Reverse of the source seat order ['ua','ub','uc'].
    expect(callArg.players.map((p) => p.userId)).toEqual(['uc', 'ub', 'ua']);
  });

  it('preserve: keeps the source-game seat order and never calls shuffle', async () => {
    const shuffleSpy = vi.fn((items: readonly unknown[]) => items.slice().reverse());
    const createFromComposition = vi.fn(async (_input: unknown) => ({
      gameId: 'newg-keep',
    }));
    const detail = makeDetail({
      settings: { ...DEFAULT_LOBBY_SETTINGS, layoutOnRepeat: 'preserve' },
    });
    const { svc } = makeService({
      detail,
      createFromComposition,
      shuffle: shuffleSpy as unknown as ShuffleFn,
    });

    await svc.initiateOrAccept('ua', 'g-1');
    await svc.accept('ub', 'g-1');
    await svc.accept('uc', 'g-1');

    expect(shuffleSpy).not.toHaveBeenCalled();
    expect(createFromComposition).toHaveBeenCalledTimes(1);
    const callArg = createFromComposition.mock.calls[0][0] as {
      players: Array<{ userId: string }>;
    };
    expect(callArg.players.map((p) => p.userId)).toEqual(['ua', 'ub', 'uc']);
  });
});
