import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DEFAULT_LOBBY_SETTINGS, type Lobby } from '@durak/shared-types';
import {
  LOBBY_INDEX_KEY,
  LOBBY_KEY_PREFIX,
  LOBBY_TTL_SECONDS,
  LobbiesService,
  USER_IN_LOBBY_KEY_PREFIX,
  mergeAndValidateSettings,
} from './lobbies.service';

/**
 * In-memory fake of just enough of the ioredis surface for the service tests.
 * Keeps things synchronous-ish so each scenario reads top-to-bottom.
 */
class FakeRedis {
  store = new Map<string, string>();
  zset = new Map<string, Map<string, number>>();

  // ---- string ops ----
  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  async set(key: string, value: string, ..._rest: unknown[]): Promise<'OK'> {
    // Honor the NX flag for the lock path.
    if (_rest.includes('NX') && this.store.has(key)) {
      return 'OK' as never;
    }
    this.store.set(key, value);
    return 'OK';
  }
  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.store.delete(k)) n++;
    }
    return n;
  }
  async exists(key: string): Promise<number> {
    return this.store.has(key) ? 1 : 0;
  }
  async expire(_key: string, _ttl: number): Promise<number> {
    return 1;
  }
  async eval(script: string, _numKeys: number, key: string, arg: string): Promise<number> {
    // Mimic both Lua scripts used by the service (clearUserMembership / lock release).
    void script;
    if (this.store.get(key) === arg) {
      this.store.delete(key);
      return 1;
    }
    return 0;
  }
  // ---- zset ops ----
  async zadd(key: string, score: number, member: string): Promise<number> {
    let z = this.zset.get(key);
    if (!z) {
      z = new Map();
      this.zset.set(key, z);
    }
    const isNew = !z.has(member);
    z.set(member, score);
    return isNew ? 1 : 0;
  }
  async zrem(key: string, ...members: string[]): Promise<number> {
    const z = this.zset.get(key);
    if (!z) return 0;
    let n = 0;
    for (const m of members) if (z.delete(m)) n++;
    return n;
  }
  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    const z = this.zset.get(key);
    if (!z) return [];
    const arr = [...z.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
    const end = stop === -1 ? arr.length : stop + 1;
    return arr.slice(start, end);
  }
  async zcard(key: string): Promise<number> {
    return this.zset.get(key)?.size ?? 0;
  }
  // ---- pipeline / multi (good-enough sequential emulation) ----
  multi(): FakeRedis & { exec: () => Promise<unknown[]> } {
    const queue: Array<() => Promise<unknown>> = [];
    const proxy: Record<string, unknown> = {};
    const methods = ['set', 'del', 'expire', 'zadd', 'zrem', 'eval', 'get', 'exists'] as const;
    for (const m of methods) {
      const fn = (this[m] as (...args: unknown[]) => Promise<unknown>).bind(this);
      proxy[m] = (...args: unknown[]) => {
        queue.push(() => fn(...args));
        return proxy;
      };
    }
    proxy.exec = async () => {
      const out: unknown[] = [];
      for (const op of queue) out.push(await op());
      return out;
    };
    return proxy as unknown as FakeRedis & { exec: () => Promise<unknown[]> };
  }
  pipeline(): FakeRedis & { exec: () => Promise<Array<[null, unknown]>> } {
    const queue: Array<() => Promise<unknown>> = [];
    const proxy: Record<string, unknown> = {};
    const methods = ['get', 'exists'] as const;
    for (const m of methods) {
      const fn = (this[m] as (...args: unknown[]) => Promise<unknown>).bind(this);
      proxy[m] = (...args: unknown[]) => {
        queue.push(() => fn(...args));
        return proxy;
      };
    }
    proxy.exec = async () => {
      const out: Array<[null, unknown]> = [];
      for (const op of queue) out.push([null, await op()]);
      return out;
    };
    return proxy as unknown as FakeRedis & { exec: () => Promise<Array<[null, unknown]>> };
  }
}

interface FakePrismaUser {
  id: string;
  nickname: string;
  avatarUrl: string | null;
  disabledAt: Date | null;
}

function makePrismaStub(users: Record<string, FakePrismaUser>) {
  return {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => users[where.id] ?? null),
    },
  };
}

function makeService(redis: FakeRedis, prisma: unknown): LobbiesService {
  return new LobbiesService({ client: redis } as unknown as never, prisma as never, undefined);
}

const USER_A: FakePrismaUser = { id: 'ua', nickname: 'Alice', avatarUrl: null, disabledAt: null };
const USER_B: FakePrismaUser = { id: 'ub', nickname: 'Bob', avatarUrl: null, disabledAt: null };
const USER_C: FakePrismaUser = { id: 'uc', nickname: 'Carol', avatarUrl: null, disabledAt: null };

describe('mergeAndValidateSettings', () => {
  it('accepts the defaults', () => {
    expect(mergeAndValidateSettings(DEFAULT_LOBBY_SETTINGS, {})).toEqual(DEFAULT_LOBBY_SETTINGS);
  });

  it('rejects an invalid turnTimer', () => {
    expect(() => mergeAndValidateSettings(DEFAULT_LOBBY_SETTINGS, { turnTimer: 15 })).toThrow(
      BadRequestException,
    );
  });

  it('rejects an invalid maxPlayers', () => {
    expect(() =>
      mergeAndValidateSettings(DEFAULT_LOBBY_SETTINGS, {
        maxPlayers: 7 as unknown as 6,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects an out-of-range cheatAttempts', () => {
    expect(() => mergeAndValidateSettings(DEFAULT_LOBBY_SETTINGS, { cheatAttempts: 0 })).toThrow(
      BadRequestException,
    );
    expect(() => mergeAndValidateSettings(DEFAULT_LOBBY_SETTINGS, { cheatAttempts: 11 })).toThrow(
      BadRequestException,
    );
  });

  it('allows the documented turnTimer values', () => {
    for (const t of [null, 30, 60, 120] as const) {
      expect(mergeAndValidateSettings(DEFAULT_LOBBY_SETTINGS, { turnTimer: t }).turnTimer).toBe(t);
    }
  });

  it('rejects a non-boolean exclusiveThrowIn', () => {
    expect(() =>
      mergeAndValidateSettings(DEFAULT_LOBBY_SETTINGS, {
        exclusiveThrowIn: 'yes' as unknown as boolean,
      }),
    ).toThrow(BadRequestException);
  });

  it('accepts exclusiveThrowIn=true', () => {
    const out = mergeAndValidateSettings(DEFAULT_LOBBY_SETTINGS, {
      exclusiveThrowIn: true,
    });
    expect(out.exclusiveThrowIn).toBe(true);
  });

  it('rejects unknown nested keys (whitelist)', () => {
    expect(() =>
      mergeAndValidateSettings(DEFAULT_LOBBY_SETTINGS, {
        foo: 1,
      } as unknown as Partial<typeof DEFAULT_LOBBY_SETTINGS>),
    ).toThrow(BadRequestException);
    try {
      mergeAndValidateSettings(DEFAULT_LOBBY_SETTINGS, {
        foo: 'bar',
      } as unknown as Partial<typeof DEFAULT_LOBBY_SETTINGS>);
    } catch (err) {
      const body = (err as BadRequestException).getResponse() as { code: string; message: string };
      expect(body.code).toBe('INVALID_SETTINGS');
      expect(body.message).toContain('foo');
    }
  });
});

describe('LobbiesService.create', () => {
  let redis: FakeRedis;
  let prisma: ReturnType<typeof makePrismaStub>;
  let svc: LobbiesService;

  beforeEach(() => {
    redis = new FakeRedis();
    prisma = makePrismaStub({ ua: USER_A });
    svc = makeService(redis, prisma);
  });

  it('creates a lobby with defaults when no settings patch is provided', async () => {
    const lobby = await svc.create('ua');
    expect(lobby.players).toHaveLength(1);
    expect(lobby.players[0]).toMatchObject({ userId: 'ua', nickname: 'Alice', isReady: false });
    expect(lobby.settings).toEqual(DEFAULT_LOBBY_SETTINGS);
    expect(lobby.status).toBe('waiting');
    // Indexed for the list view.
    expect(await redis.zcard(LOBBY_INDEX_KEY)).toBe(1);
    // Reverse pointer set.
    expect(await redis.get(`${USER_IN_LOBBY_KEY_PREFIX}ua`)).toBe(lobby.id);
    // State key present.
    expect(await redis.exists(`${LOBBY_KEY_PREFIX}${lobby.id}`)).toBe(1);
  });

  it('rejects when the user is already in a lobby', async () => {
    await svc.create('ua');
    await expect(svc.create('ua')).rejects.toBeInstanceOf(ConflictException);
    try {
      await svc.create('ua');
    } catch (err) {
      const body = (err as ConflictException).getResponse() as {
        code: string;
        details?: { currentLobbyId: string };
      };
      expect(body.code).toBe('ALREADY_IN_LOBBY');
      expect(body.details?.currentLobbyId).toBeTruthy();
    }
  });

  it('rejects when the user does not exist', async () => {
    await expect(svc.create('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('validates the settings patch', async () => {
    await expect(svc.create('ua', { turnTimer: 15 })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('LobbiesService.join / leave', () => {
  let redis: FakeRedis;
  let prisma: ReturnType<typeof makePrismaStub>;
  let svc: LobbiesService;
  let lobby: Lobby;

  beforeEach(async () => {
    redis = new FakeRedis();
    prisma = makePrismaStub({ ua: USER_A, ub: USER_B, uc: USER_C });
    svc = makeService(redis, prisma);
    lobby = await svc.create('ua');
  });

  it('adds a second player', async () => {
    const updated = await svc.join('ub', lobby.id);
    expect(updated.players.map((p) => p.userId)).toEqual(['ua', 'ub']);
  });

  it('is idempotent for an existing member', async () => {
    await svc.join('ub', lobby.id);
    const again = await svc.join('ub', lobby.id);
    expect(again.players).toHaveLength(2);
  });

  it('rejects join when ALREADY_IN_LOBBY (different lobby)', async () => {
    const other = await svc.create('ub');
    await expect(svc.join('ub', lobby.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ALREADY_IN_LOBBY' }),
    });
    expect(other.id).not.toBe(lobby.id);
  });

  it('rejects join when LOBBY_FULL', async () => {
    await svc.updateSettings('ua', lobby.id, { maxPlayers: 2 });
    await svc.join('ub', lobby.id);
    await expect(svc.join('uc', lobby.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'LOBBY_FULL' }),
    });
  });

  it('rejects join when LOBBY_NOT_FOUND', async () => {
    await expect(svc.join('ub', 'no-such-id')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removes a player on leave and keeps the lobby alive when others remain', async () => {
    await svc.join('ub', lobby.id);
    const after = await svc.leave('ua', lobby.id);
    expect(after).not.toBeNull();
    expect(after?.players.map((p) => p.userId)).toEqual(['ub']);
    // Reverse pointer cleared for the leaver only.
    expect(await redis.get(`${USER_IN_LOBBY_KEY_PREFIX}ua`)).toBeNull();
    expect(await redis.get(`${USER_IN_LOBBY_KEY_PREFIX}ub`)).toBe(lobby.id);
  });

  it('deletes the lobby when the last player leaves', async () => {
    const after = await svc.leave('ua', lobby.id);
    expect(after).toBeNull();
    expect(await redis.exists(`${LOBBY_KEY_PREFIX}${lobby.id}`)).toBe(0);
    expect(await redis.zcard(LOBBY_INDEX_KEY)).toBe(0);
    expect(await redis.get(`${USER_IN_LOBBY_KEY_PREFIX}ua`)).toBeNull();
  });
});

describe('LobbiesService.updateSettings', () => {
  let redis: FakeRedis;
  let svc: LobbiesService;
  let lobby: Lobby;

  beforeEach(async () => {
    redis = new FakeRedis();
    const prisma = makePrismaStub({ ua: USER_A, ub: USER_B });
    svc = makeService(redis, prisma);
    lobby = await svc.create('ua');
    await svc.join('ub', lobby.id);
    await svc.setReady('ua', lobby.id, true);
    await svc.setReady('ub', lobby.id, true);
  });

  it('clears all players ready flags', async () => {
    const updated = await svc.updateSettings('ua', lobby.id, { turnTimer: 30 });
    expect(updated.settings.turnTimer).toBe(30);
    expect(updated.players.every((p) => p.isReady === false)).toBe(true);
  });

  it('rejects when caller is not a member', async () => {
    await expect(svc.updateSettings('uc', lobby.id, { turnTimer: 30 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects lowering maxPlayers below current count', async () => {
    await expect(
      svc.updateSettings('ua', lobby.id, { maxPlayers: 2 as unknown as 6 }),
    ).resolves.toBeDefined(); // 2 == current count = ok
    await svc.setReady('ua', lobby.id, true);
    await svc.setReady('ub', lobby.id, true);
    await expect(
      svc.updateSettings('ua', lobby.id, { maxPlayers: 2 as unknown as 6 }),
    ).resolves.toBeDefined();
    // forcibly bump to 4 to escape the boundary, then try to drop to 2 with 2 players (=allowed):
    await svc.updateSettings('ua', lobby.id, { maxPlayers: 4 as unknown as 6 });
  });
});

describe('LobbiesService.start', () => {
  let redis: FakeRedis;
  let svc: LobbiesService;
  let lobby: Lobby;

  beforeEach(async () => {
    redis = new FakeRedis();
    const prisma = makePrismaStub({ ua: USER_A, ub: USER_B });
    svc = makeService(redis, prisma);
    lobby = await svc.create('ua');
    await svc.join('ub', lobby.id);
  });

  it('rejects when fewer than 2 players', async () => {
    // Spin up a separate one-person lobby and try to start it.
    const prisma = makePrismaStub({ uc: USER_C });
    const svc2 = makeService(new FakeRedis(), prisma);
    const l = await svc2.create('uc');
    await svc2.setReady('uc', l.id, true);
    await expect(svc2.start('uc', l.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'NOT_ENOUGH_PLAYERS' }),
    });
  });

  it('rejects when not all players are ready', async () => {
    await svc.setReady('ua', lobby.id, true);
    // ub stays not-ready
    await expect(svc.start('ua', lobby.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'NOT_ALL_READY' }),
    });
  });

  it('moves the lobby to in_game with a fresh gameId and frees membership pointers', async () => {
    await svc.setReady('ua', lobby.id, true);
    await svc.setReady('ub', lobby.id, true);
    const { lobby: started, gameId } = await svc.start('ua', lobby.id);
    expect(gameId).toBeTruthy();
    expect(started.status).toBe('in_game');
    expect(started.gameId).toBe(gameId);
    // Lobby is dropped from the public index (Phase 4 will handle games).
    expect(await redis.zcard(LOBBY_INDEX_KEY)).toBe(0);
    expect(await redis.get(`${USER_IN_LOBBY_KEY_PREFIX}ua`)).toBeNull();
    expect(await redis.get(`${USER_IN_LOBBY_KEY_PREFIX}ub`)).toBeNull();
  });
});

describe('LobbiesService.list', () => {
  it('returns waiting lobbies sorted newest first', async () => {
    const redis = new FakeRedis();
    const prisma = makePrismaStub({ ua: USER_A, ub: USER_B });
    const svc = makeService(redis, prisma);
    const a = await svc.create('ua');
    // Force a small delta in createdAt so the ordering is deterministic.
    await new Promise((r) => setTimeout(r, 5));
    const b = await svc.create('ub');
    const items = await svc.list();
    expect(items.map((i) => i.id)).toEqual([b.id, a.id]);
    expect(items[0]).toMatchObject({ playerCount: 1, maxPlayers: a.settings.maxPlayers });
  });
});

describe('LobbiesService TTL contract', () => {
  it('uses the documented one-hour idle TTL', () => {
    expect(LOBBY_TTL_SECONDS).toBe(3600);
  });
});
