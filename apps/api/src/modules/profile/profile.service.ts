import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ProfileStats, PublicProfile } from '@durak/shared-types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { conservativeRating } from '../rating/rating.service';
import { GamesHistoryService } from '../games/games-history.service';

/** Cap on the "last games" mini-feed shown in the profile card. */
const PROFILE_LAST_GAMES_LIMIT = 5;

interface AggSum {
  _count: { _all: number };
  _sum: Partial<{
    cheatAttemptedTotal: number;
    cheatCaught: number;
    cheatEscaped: number;
    noticesIssued: number;
    noticesCorrect: number;
    noticesWrong: number;
    translatesMade: number;
    takesAsked: number;
    cardsTaken: number;
    attacksMade: number;
    beatsMade: number;
    boutsAttacked: number;
    boutsDefended: number;
  }>;
}

interface ProfilePrismaSlice {
  gameParticipant: {
    aggregate(args: {
      where: { userId: string };
      _count?: { _all: true };
      _sum?: Record<string, true>;
    }): Promise<AggSum>;
    count(args: {
      where: { userId: string; isWinner?: boolean; isLoser?: boolean };
    }): Promise<number>;
  };
}

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly history: GamesHistoryService,
  ) {}

  async getPublicProfile(userId: string): Promise<PublicProfile> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.disabledAt) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    }
    const [stats, lastGames] = await Promise.all([
      this.computeStats(userId, user.gamesPlayed ?? 0),
      this.history.listLastForUser(userId, PROFILE_LAST_GAMES_LIMIT),
    ]);
    return {
      id: user.id,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      isAdmin: user.isAdmin,
      rating: conservativeRating(user.trueskillMu, user.trueskillSigma),
      trueskill: {
        mu: user.trueskillMu,
        sigma: user.trueskillSigma,
      },
      stats,
      lastGames,
      cardBackId: user.cardBackId,
      randomCardBack: user.randomCardBack,
      customCardBackUrl: user.customCardBackUrl,
    };
  }

  private async computeStats(userId: string, gamesPlayed: number): Promise<ProfileStats> {
    const prisma = this.prisma as unknown as ProfilePrismaSlice;
    try {
      const [agg, wins, losses] = await Promise.all([
        prisma.gameParticipant.aggregate({
          where: { userId },
          _count: { _all: true },
          _sum: {
            cheatAttemptedTotal: true,
            cheatCaught: true,
            cheatEscaped: true,
            noticesIssued: true,
            noticesCorrect: true,
            noticesWrong: true,
            translatesMade: true,
            takesAsked: true,
            cardsTaken: true,
            attacksMade: true,
            beatsMade: true,
            boutsAttacked: true,
            boutsDefended: true,
          },
        }),
        prisma.gameParticipant.count({ where: { userId, isWinner: true } }),
        prisma.gameParticipant.count({ where: { userId, isLoser: true } }),
      ]);
      // Prefer the aggregated participant count over `User.gamesPlayed` so the
      // stats remain consistent even if the counter ever drifts.
      const total = agg._count._all > 0 ? agg._count._all : gamesPlayed;
      const safeDivide = (n: number, d: number) => (d > 0 ? n / d : 0);
      const sum = agg._sum;
      return {
        gamesPlayed: total,
        wins,
        lastPlaces: losses,
        firstPlaceRate: safeDivide(wins, total),
        lastPlaceRate: safeDivide(losses, total),
        cheatAttempts: sum.cheatAttemptedTotal ?? 0,
        cheatCaught: sum.cheatCaught ?? 0,
        cheatEscaped: sum.cheatEscaped ?? 0,
        noticesIssued: sum.noticesIssued ?? 0,
        noticesCorrect: sum.noticesCorrect ?? 0,
        noticesWrong: sum.noticesWrong ?? 0,
        translatesMade: sum.translatesMade ?? 0,
        takesAsked: sum.takesAsked ?? 0,
        cardsTaken: sum.cardsTaken ?? 0,
        attacksMade: sum.attacksMade ?? 0,
        beatsMade: sum.beatsMade ?? 0,
        boutsAttacked: sum.boutsAttacked ?? 0,
        boutsDefended: sum.boutsDefended ?? 0,
      };
    } catch (err) {
      // Defensive fallback — never let the profile fail because aggregates
      // misbehaved (e.g. migration race). Zero out and log.
      this.logger.warn({ err, userId }, 'profile stats aggregate failed; returning zeros');
      return {
        gamesPlayed,
        wins: 0,
        lastPlaces: 0,
        firstPlaceRate: 0,
        lastPlaceRate: 0,
        cheatAttempts: 0,
        cheatCaught: 0,
      };
    }
  }
}
