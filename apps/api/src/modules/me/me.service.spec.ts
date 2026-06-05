import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MeService, type IMePrismaClient } from './me.service';
import { AuthService } from '../auth/auth.service';
import { CardBacksService } from '../card-backs/card-backs.service';

interface FakeUser {
  id: string;
  login: string;
  nickname: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
  avatarUrl: string | null;
  cardBackId: string;
  randomCardBack: boolean;
  customCardBackUrl: string | null;
}

const baseUser: FakeUser = {
  id: 'u1',
  login: 'admin',
  nickname: 'Admin',
  isAdmin: true,
  mustChangePassword: false,
  avatarUrl: null,
  cardBackId: 'classic-1',
  randomCardBack: false,
  customCardBackUrl: null,
};

function makePrismaStub(user: FakeUser) {
  let current = { ...user };
  return {
    user: {
      findUnique: vi.fn(async () => ({ customCardBackUrl: current.customCardBackUrl })),
      update: vi.fn(async ({ data }: { data: Prisma.UserUpdateInput }) => {
        current = { ...current, ...(data as Partial<FakeUser>) };
        return current;
      }),
    },
    _current: () => current,
  };
}

function makeAuthStub(): AuthService {
  return {
    toPublicUser: (u: FakeUser) => ({ ...u, currentGameId: null }),
    resolveCurrentGameId: async () => null,
  } as unknown as AuthService;
}

describe('MeService.run', () => {
  const cardBacks = new CardBacksService();

  it('rejects unknown cardBackId with 400 CARD_BACK_NOT_FOUND', async () => {
    const prisma = makePrismaStub(baseUser);
    const auth = makeAuthStub();
    await expect(
      MeService.run(prisma as unknown as IMePrismaClient, cardBacks, auth, 'u1', {
        cardBackId: 'definitely-not-real',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    try {
      await MeService.run(prisma as unknown as IMePrismaClient, cardBacks, auth, 'u1', {
        cardBackId: 'definitely-not-real',
      });
    } catch (err) {
      const e = err as BadRequestException;
      expect((e.getResponse() as { code: string }).code).toBe('CARD_BACK_NOT_FOUND');
    }
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects the __random__ sentinel as cardBackId with 400', async () => {
    const prisma = makePrismaStub(baseUser);
    const auth = makeAuthStub();
    await expect(
      MeService.run(prisma as unknown as IMePrismaClient, cardBacks, auth, 'u1', {
        cardBackId: '__random__',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('persists a valid cardBackId', async () => {
    const prisma = makePrismaStub(baseUser);
    const auth = makeAuthStub();
    const res = await MeService.run(prisma as unknown as IMePrismaClient, cardBacks, auth, 'u1', {
      cardBackId: 'classic-2',
    });
    expect(res.user.cardBackId).toBe('classic-2');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { cardBackId: 'classic-2' },
    });
  });

  it('accepts randomCardBack=true without cardBackId', async () => {
    const prisma = makePrismaStub(baseUser);
    const auth = makeAuthStub();
    const res = await MeService.run(prisma as unknown as IMePrismaClient, cardBacks, auth, 'u1', {
      randomCardBack: true,
    });
    expect(res.user.randomCardBack).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { randomCardBack: true },
    });
  });

  it('updates nickname when provided', async () => {
    const prisma = makePrismaStub(baseUser);
    const auth = makeAuthStub();
    const res = await MeService.run(prisma as unknown as IMePrismaClient, cardBacks, auth, 'u1', {
      nickname: 'Newbie',
    });
    expect(res.user.nickname).toBe('Newbie');
  });

  it('rejects __custom__ cardBackId when user has no upload (400 CUSTOM_CARD_BACK_NOT_SET)', async () => {
    const prisma = makePrismaStub({ ...baseUser, customCardBackUrl: null });
    const auth = makeAuthStub();
    await expect(
      MeService.run(prisma as unknown as IMePrismaClient, cardBacks, auth, 'u1', {
        cardBackId: '__custom__',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    try {
      await MeService.run(prisma as unknown as IMePrismaClient, cardBacks, auth, 'u1', {
        cardBackId: '__custom__',
      });
    } catch (err) {
      const e = err as BadRequestException;
      expect((e.getResponse() as { code: string }).code).toBe('CUSTOM_CARD_BACK_NOT_SET');
    }
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('persists __custom__ cardBackId when user has an upload', async () => {
    const prisma = makePrismaStub({
      ...baseUser,
      customCardBackUrl: '/uploads/card-backs/u1.webp?v=1',
    });
    const auth = makeAuthStub();
    const res = await MeService.run(prisma as unknown as IMePrismaClient, cardBacks, auth, 'u1', {
      cardBackId: '__custom__',
    });
    expect(res.user.cardBackId).toBe('__custom__');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { cardBackId: '__custom__' },
    });
  });

  it('maps P2002 on nickname to 409 NICKNAME_TAKEN', async () => {
    const prisma = makePrismaStub(baseUser);
    prisma.user.update = vi.fn(async () => {
      throw new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: ['nickname'] },
      });
    });
    const auth = makeAuthStub();
    await expect(
      MeService.run(prisma as unknown as IMePrismaClient, cardBacks, auth, 'u1', {
        nickname: 'taken',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
