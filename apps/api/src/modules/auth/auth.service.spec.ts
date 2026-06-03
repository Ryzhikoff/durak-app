import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PasswordHasher } from './password-hasher';
import { SessionService } from './session.service';

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

describe('AuthService.login', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let hasher: PasswordHasher;
  let sessions: ReturnType<typeof makeSessionStub>;
  let svc: AuthService;

  beforeEach(() => {
    prisma = makePrismaStub({ ...baseUser });
    sessions = makeSessionStub();
    hasher = {
      hash: vi.fn(async () => 'newhash'),
      verify: vi.fn(async (_h: string, p: string) => p === 'correct'),
    } as unknown as PasswordHasher;
    svc = new AuthService(
      prisma as unknown as never,
      hasher,
      sessions as unknown as SessionService,
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
