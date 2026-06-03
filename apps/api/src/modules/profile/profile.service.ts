import { Injectable, NotFoundException } from '@nestjs/common';
import type { ProfileStats, PublicProfile } from '@durak/shared-types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { conservativeRating } from '../rating/rating.service';

/** Stats placeholder — populated when the game pipeline ships in Phase 4+. */
const EMPTY_STATS: ProfileStats = {
  gamesPlayed: 0,
  wins: 0,
  lastPlaces: 0,
  firstPlaceRate: 0,
  lastPlaceRate: 0,
  cheatAttempts: 0,
  cheatCaught: 0,
};

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicProfile(userId: string): Promise<PublicProfile> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.disabledAt) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    }
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
      stats: { ...EMPTY_STATS },
      lastGames: [],
      cardBackId: user.cardBackId,
      randomCardBack: user.randomCardBack,
      customCardBackUrl: user.customCardBackUrl,
    };
  }
}
