import { describe, it, expect } from 'vitest';
import { RatingService, conservativeRating, type IRatingPrismaClient } from './rating.service';

interface Row {
  id: string;
  nickname: string;
  avatarUrl: string | null;
  trueskillMu: number;
  trueskillSigma: number;
  updatedAt: Date;
}

function makePrismaStub(rows: Row[]): IRatingPrismaClient {
  return {
    user: {
      count: async () => rows.length,
      findMany: async (args) => {
        const take = args.take ?? rows.length;
        return rows.slice(0, take);
      },
    },
  };
}

const NOW = new Date('2026-06-01T00:00:00Z');

describe('RatingService.run', () => {
  it('sorts users by (mu - 3*sigma) descending and paginates', async () => {
    const rows: Row[] = [
      // raw display: a=10, b=25, c=15, d=20
      {
        id: 'a',
        nickname: 'A',
        avatarUrl: null,
        trueskillMu: 25,
        trueskillSigma: 5,
        updatedAt: NOW,
      },
      {
        id: 'b',
        nickname: 'B',
        avatarUrl: null,
        trueskillMu: 28,
        trueskillSigma: 1,
        updatedAt: NOW,
      },
      {
        id: 'c',
        nickname: 'C',
        avatarUrl: null,
        trueskillMu: 30,
        trueskillSigma: 5,
        updatedAt: NOW,
      },
      {
        id: 'd',
        nickname: 'D',
        avatarUrl: null,
        trueskillMu: 26,
        trueskillSigma: 2,
        updatedAt: NOW,
      },
    ];
    const res = await RatingService.run(makePrismaStub(rows), { page: 1, limit: 2 });
    expect(res.total).toBe(4);
    expect(res.page).toBe(1);
    expect(res.limit).toBe(2);
    expect(res.items.map((i) => i.id)).toEqual(['b', 'd']);
    expect(res.items[0]?.rating).toBe(25);
    expect(res.items[0]?.gamesPlayed).toBe(0);
    expect(res.items[0]?.lastSeenAt).toBe(NOW.toISOString());

    const page2 = await RatingService.run(makePrismaStub(rows), { page: 2, limit: 2 });
    expect(page2.items.map((i) => i.id)).toEqual(['c', 'a']);
  });

  it('returns empty page when out of bounds', async () => {
    const rows: Row[] = [
      {
        id: 'a',
        nickname: 'A',
        avatarUrl: null,
        trueskillMu: 25,
        trueskillSigma: 5,
        updatedAt: NOW,
      },
    ];
    const res = await RatingService.run(makePrismaStub(rows), { page: 5, limit: 20 });
    expect(res.total).toBe(1);
    expect(res.items).toEqual([]);
  });
});

describe('conservativeRating', () => {
  it('rounds mu - 3*sigma to integer', () => {
    expect(conservativeRating(25, 8.333333)).toBe(0);
    expect(conservativeRating(30, 1)).toBe(27);
    expect(conservativeRating(15.4, 0)).toBe(15);
    expect(conservativeRating(15.6, 0)).toBe(16);
  });
});
