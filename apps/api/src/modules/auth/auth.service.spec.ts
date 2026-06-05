import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PasswordHasher } from './password-hasher';
import { SessionService } from './session.service';
import { RedisService } from '../../infrastructure/redis/redis.service';

interface FakeUser {
  id: string;
  login: string;
  nickname: string;
  passwordHash: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
  avatarUrl: string | null;
  cardBackId: string;
  randomCardBack: boolean;
  customCardBackUrl: string | null;
  disabledAt: Date | null;
}

const baseUser: FakeUser = {
  id: 'u1',
  login: 'admin',
  nickname: 'Admin',
  passwordHash: 'hash',
  isAdmin: true,
  mustChangePassword: false,
  avatarUrl: null,
  cardBackId: 'classic-1',
  randomCardBack: false,
  customCardBackUrl: null,
  disabledAt: null,
};

function makePrismaStub(user: FakeUser | null) {
  let current = user ? { ...user } : null;
  return {
    user: {
      findUnique: vi.fn(async () => current),
      update: vi.fn(async ({ data }: { data: Partial<FakeUser> }) => {
        if (!current) throw new Error('no user');
        current = { ...current, ...data };
        return current;
      }),
    },
    _current: () => current,
  };
}

function makeSessionStub() {
  return {
    create: vi.fn(async () => ({ id: 'sess1', ttlSeconds: 30 })),
    get: vi.fn(),
    touch: vi.fn(),
    update: vi.fn(),
    destroy: vi.fn(),
    destroyAllForUser: vi.fn(),
    destroyAllForUserExcept: vi.fn(),
  };
}

/**
 * Minimal in-memory stand-in for the ioredis surface AuthService touches —
 * `GET userInGame:<userId>` and `EXISTS game:<id>`. Tests prime the map up
 * front and assert on the resolved currentGameId.
 */
function makeRedisStub(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const client = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
  };
  return { client } as unknown as RedisService;
}

describe('AuthService.login', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let hasher: PasswordHasher;
  let sessions: ReturnType<typeof makeSessionStub>;
  let redis: RedisService;
  let svc: AuthService;

  beforeEach(() => {
    prisma = makePrismaStub({ ...baseUser });
    sessions = makeSessionStub();
    hasher = {
      hash: vi.fn(async () => 'newhash'),
      verify: vi.fn(async (_h: string, p: string) => p === 'correct'),
    } as unknown as PasswordHasher;
    redis = makeRedisStub();
    svc = new AuthService(
      prisma as unknown as never,
      hasher,
      sessions as unknown as SessionService,
      redis,
    );
  });

  it('rejects unknown login with 401', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(svc.login('nobody', 'whatever', {})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects wrong password with 401', async () => {
    await expect(svc.login('admin', 'wrong', {})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects disabled account with 403', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      ...baseUser,
      disabledAt: new Date(),
    });
    await expect(svc.login('admin', 'correct', {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns user and creates session on success, lowercases login', async () => {
    const res = await svc.login('ADMIN', 'correct', { userAgent: 'ua', ip: '1.1.1.1' });
    expect(res.user.id).toBe('u1');
    expect(res.sessionId).toBe('sess1');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { login: 'admin' } });
    expect(sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        isAdmin: true,
        mustChangePassword: false,
        userAgent: 'ua',
        ip: '1.1.1.1',
      }),
    );
  });
});

describe('AuthService.changePassword', () => {
  it('updates hash, clears flag, updates session and invalidates other sessions', async () => {
    const prisma = makePrismaStub({ ...baseUser, mustChangePassword: true });
    const sessions = makeSessionStub();
    const hasher = {
      hash: vi.fn(async () => 'newhash'),
      verify: vi.fn(async (_h: string, p: string) => p === 'old'),
    } as unknown as PasswordHasher;
    const svc = new AuthService(
      prisma as unknown as never,
      hasher,
      sessions as unknown as SessionService,
      makeRedisStub(),
    );

    const res = await svc.changePassword('u1', 'sess1', 'old', 'brand-new');
    expect(res.mustChangePassword).toBe(false);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { passwordHash: 'newhash', mustChangePassword: false },
    });
    expect(sessions.update).toHaveBeenCalledWith('sess1', { mustChangePassword: false });
    // current session must NOT be destroyed; all others should be.
    expect(sessions.destroyAllForUserExcept).toHaveBeenCalledWith('u1', 'sess1');
    expect(sessions.destroyAllForUser).not.toHaveBeenCalled();
    expect(sessions.destroy).not.toHaveBeenCalled();
  });

  it('rejects when current password is wrong with 400 INVALID_CURRENT_PASSWORD', async () => {
    const prisma = makePrismaStub({ ...baseUser });
    const sessions = makeSessionStub();
    const hasher = {
      hash: vi.fn(),
      verify: vi.fn(async () => false),
    } as unknown as PasswordHasher;
    const svc = new AuthService(
      prisma as unknown as never,
      hasher,
      sessions as unknown as SessionService,
      makeRedisStub(),
    );
    await expect(svc.changePassword('u1', 'sess1', 'bad', 'new')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    try {
      await svc.changePassword('u1', 'sess1', 'bad', 'new');
    } catch (err) {
      const e = err as BadRequestException;
      const body = e.getResponse() as { code: string };
      expect(body.code).toBe('INVALID_CURRENT_PASSWORD');
    }
    expect(sessions.destroyAllForUserExcept).not.toHaveBeenCalled();
  });

  it('rejects when new password equals current with 400 NEW_PASSWORD_SAME_AS_CURRENT', async () => {
    const prisma = makePrismaStub({ ...baseUser });
    const sessions = makeSessionStub();
    const hasher = {
      hash: vi.fn(),
      verify: vi.fn(async () => true),
    } as unknown as PasswordHasher;
    const svc = new AuthService(
      prisma as unknown as never,
      hasher,
      sessions as unknown as SessionService,
      makeRedisStub(),
    );
    await expect(svc.changePassword('u1', 'sess1', 'same', 'same')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    try {
      await svc.changePassword('u1', 'sess1', 'same', 'same');
    } catch (err) {
      const e = err as BadRequestException;
      const body = e.getResponse() as { code: string };
      expect(body.code).toBe('NEW_PASSWORD_SAME_AS_CURRENT');
    }
    expect(sessions.destroyAllForUserExcept).not.toHaveBeenCalled();
  });
});

describe('AuthService.getMe', () => {
  function makeSvc(redis: RedisService, userOverride: Partial<FakeUser> = {}) {
    const prisma = makePrismaStub({ ...baseUser, ...userOverride });
    const sessions = makeSessionStub();
    const hasher = {
      hash: vi.fn(),
      verify: vi.fn(),
    } as unknown as PasswordHasher;
    return new AuthService(
      prisma as unknown as never,
      hasher,
      sessions as unknown as SessionService,
      redis,
    );
  }

  it('returns currentGameId from Redis when userInGame and game keys exist', async () => {
    const redis = makeRedisStub({
      'userInGame:u1': 'game-xyz',
      'game:game-xyz': '{}',
    });
    const svc = makeSvc(redis);
    const res = await svc.getMe('u1');
    expect(res.currentGameId).toBe('game-xyz');
  });

  it('returns currentGameId=null when no userInGame pointer is set', async () => {
    const redis = makeRedisStub();
    const svc = makeSvc(redis);
    const res = await svc.getMe('u1');
    expect(res.currentGameId).toBeNull();
  });

  it('returns currentGameId=null when the pointer is stale (game key absent)', async () => {
    const redis = makeRedisStub({ 'userInGame:u1': 'orphan' });
    const svc = makeSvc(redis);
    const res = await svc.getMe('u1');
    expect(res.currentGameId).toBeNull();
  });
});

describe('AuthService.login currentGameId surfacing', () => {
  it('returns currentGameId on a successful login when the pointer is live', async () => {
    const prisma = makePrismaStub({ ...baseUser });
    const sessions = makeSessionStub();
    const hasher = {
      hash: vi.fn(),
      verify: vi.fn(async (_h: string, p: string) => p === 'correct'),
    } as unknown as PasswordHasher;
    const redis = makeRedisStub({
      'userInGame:u1': 'game-abc',
      'game:game-abc': '{}',
    });
    const svc = new AuthService(
      prisma as unknown as never,
      hasher,
      sessions as unknown as SessionService,
      redis,
    );
    const res = await svc.login('admin', 'correct', {});
    expect(res.user.currentGameId).toBe('game-abc');
  });
});
