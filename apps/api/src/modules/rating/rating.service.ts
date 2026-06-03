import { Injectable } from '@nestjs/common';
import type { RatingEntry, RatingListResponse } from '@durak/shared-types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** Conservative TrueSkill display value used everywhere in the app. */
export function conservativeRating(mu: number, sigma: number): number {
  return Math.round(mu - 3 * sigma);
}

interface RatingUserRow {
  id: string;
  nickname: string;
  avatarUrl: string | null;
  trueskillMu: number;
  trueskillSigma: number;
  updatedAt: Date;
}

export interface IRatingPrismaClient {
  user: {
    count(args: { where: { disabledAt: null } }): Promise<number>;
    findMany(args: {
      where: { disabledAt: null };
      select: {
        id: true;
        nickname: true;
        avatarUrl: true;
        trueskillMu: true;
        trueskillSigma: true;
        updatedAt: true;
      };
      take: number;
    }): Promise<RatingUserRow[]>;
  };
}

@Injectable()
export class RatingService {
  constructor(private readonly prisma: PrismaService) {}

  async list(opts: { page: number; limit: number }): Promise<RatingListResponse> {
    return RatingService.run(this.prisma as unknown as IRatingPrismaClient, opts);
  }

  /**
   * Pure functional core for testability — pass in any prisma-shaped client.
   *
   * Sorting by `mu - 3*sigma` cannot be expressed directly in Prisma's
   * `orderBy`, so we fetch all active users, sort in memory and paginate.
   * Acceptable while the user count is small (Phase 2). When this becomes a
   * bottleneck we'll materialize a `trueskillDisplay` column.
   */
  static async run(
    prisma: IRatingPrismaClient,
    opts: { page: number; limit: number },
  ): Promise<RatingListResponse> {
    const where = { disabledAt: null } as const;
    // TODO Phase 7+: materialize rating column for proper DB-side ORDER BY + pagination
    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          id: true,
          nickname: true,
          avatarUrl: true,
          trueskillMu: true,
          trueskillSigma: true,
          updatedAt: true,
        },
        take: 5000,
      }),
    ]);

    const sorted = rows
      .map((u) => ({ ...u, _display: u.trueskillMu - 3 * u.trueskillSigma }))
      .sort((a, b) => b._display - a._display);

    const start = (opts.page - 1) * opts.limit;
    const page = sorted.slice(start, start + opts.limit);

    const items: RatingEntry[] = page.map((u) => ({
      id: u.id,
      nickname: u.nickname,
      avatarUrl: u.avatarUrl,
      rating: conservativeRating(u.trueskillMu, u.trueskillSigma),
      gamesPlayed: 0, // TODO: Phase 4 — when the Game model lands.
      lastSeenAt: u.updatedAt.toISOString(),
    }));

    return {
      items,
      total,
      page: opts.page,
      limit: opts.limit,
    };
  }
}
