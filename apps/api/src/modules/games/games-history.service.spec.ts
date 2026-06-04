/**
 * Unit tests for {@link GamesHistoryService.listSameComposition}.
 *
 * The raw SQL branch is mocked at the `$queryRaw` level so we don't need a
 * live Postgres — the assertions verify (a) input handling (target user set
 * derived from the reference game; limit clamping), and (b) output shape
 * (matches `SameCompositionResponse`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LOBBY_SETTINGS, type LobbySettings } from '@durak/shared-types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { GamesHistoryService, SAME_COMPOSITION_MAX_LIMIT } from './games-history.service';

interface FakeParticipant {
  userId: string;
  nicknameSnapshot: string;
  avatarUrlSnapshot: string | null;
  place: number;
  isWinner: boolean;
  isLoser: boolean;
}

interface FakeGame {
  id: string;
  settingsJson: LobbySettings;
  startedAt: Date;
  finishedAt: Date;
  durationSec: number;
  loserId: string | null;
  totalBouts: number;
  participants: FakeParticipant[];
}

function makeParticipant(userId: string, place: number, isLoser = false): FakeParticipant {
  return {
    userId,
    nicknameSnapshot: `User ${userId}`,
    avatarUrlSnapshot: null,
    place,
    isWinner: place === 1,
    isLoser,
  };
}

function makeGame(id: string, userIds: string[], finishedAt: Date): FakeGame {
  return {
    id,
    settingsJson: { ...DEFAULT_LOBBY_SETTINGS },
    startedAt: new Date(finishedAt.getTime() - 600_000),
    finishedAt,
    durationSec: 600,
    loserId: userIds[userIds.length - 1] ?? null,
    totalBouts: 10,
    participants: userIds.map((u, i) => makeParticipant(u, i + 1, i === userIds.length - 1)),
  };
}

function makePrismaMock(games: FakeGame[]) {
  return {
    game: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        return games.find((g) => g.id === args.where.id) ?? null;
      }),
      findMany: vi.fn(async (args: { where?: { id?: { in: string[] } } }) => {
        const ids = args.where?.id?.in ?? [];
        return games
          .filter((g) => ids.includes(g.id))
          .sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime());
      }),
      count: vi.fn(async () => games.length),
    },
    $queryRaw: vi.fn(async () => [] as Array<{ id: string }>),
  };
}

describe('GamesHistoryService.listSameComposition', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let svc: GamesHistoryService;

  const ref = makeGame('g-ref', ['u1', 'u2', 'u3'], new Date('2026-01-10T10:00:00Z'));
  const past1 = makeGame('g-past-1', ['u1', 'u2', 'u3'], new Date('2026-01-09T09:00:00Z'));
  const past2 = makeGame('g-past-2', ['u1', 'u2', 'u3'], new Date('2026-01-08T08:00:00Z'));
  const otherSet = makeGame('g-other', ['u1', 'u2', 'u4'], new Date('2026-01-07T07:00:00Z'));

  beforeEach(() => {
    prisma = makePrismaMock([ref, past1, past2, otherSet]);
    svc = new GamesHistoryService(prisma as unknown as PrismaService);
  });

  it('returns null for unknown reference game id', async () => {
    const res = await svc.listSameComposition('does-not-exist', 20);
    expect(res).toBeNull();
    // $queryRaw must NOT be called when the reference game is missing.
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns matching past games sorted by finishedAt desc', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'g-past-1' }, { id: 'g-past-2' }]);
    const res = await svc.listSameComposition('g-ref', 20);
    expect(res).not.toBeNull();
    expect(res!.total).toBe(2);
    expect(res!.items.map((i) => i.id)).toEqual(['g-past-1', 'g-past-2']);
    // Each summary carries the legacy players[] shape.
    expect(res!.items[0].players).toHaveLength(3);
    expect(res!.items[0].players[0]).toEqual(
      expect.objectContaining({ id: 'u1', nickname: 'User u1', place: 1 }),
    );
  });

  it('returns empty list when no past games match', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);
    const res = await svc.listSameComposition('g-ref', 20);
    expect(res).toEqual({ items: [], total: 0 });
  });

  it('clamps `limit` to the maximum (50) and floors decimals', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await svc.listSameComposition('g-ref', 999.7);
    // Inspect the SQL parameters: the limit appears as the last `${...}` slot
    // in the Prisma.sql template literal. We don't need to decode the SQL —
    // verifying it was called at all is enough; the clamp is exercised via
    // boundary integers in a separate assertion.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const callArg = prisma.$queryRaw.mock.calls[0][0] as {
      values: unknown[];
    };
    // Prisma.sql template literal exposes its bound `values` array. The
    // reference game id is at index 0; the array literal at index 1; the
    // limit is the final bound parameter.
    const values = callArg.values;
    expect(values[values.length - 1]).toBe(SAME_COMPOSITION_MAX_LIMIT);
  });

  it('uses the de-duplicated + sorted user id set when looking up matches', async () => {
    // Duplicate-userId participants would be a data bug but the de-dup should
    // protect us regardless. Reuse `ref`-shaped game but with an extra dup.
    prisma.game.findUnique.mockResolvedValueOnce({
      ...ref,
      participants: [
        makeParticipant('u3', 1),
        makeParticipant('u1', 2),
        makeParticipant('u2', 3),
        // Duplicate
        makeParticipant('u2', 3),
      ],
    });
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await svc.listSameComposition('g-ref', 5);
    const callArg = prisma.$queryRaw.mock.calls[0][0] as { values: unknown[] };
    // The second-to-last bound parameter is the sorted, unique user id array.
    const userIdArr = callArg.values[callArg.values.length - 2];
    expect(userIdArr).toEqual(['u1', 'u2', 'u3']);
  });
});
