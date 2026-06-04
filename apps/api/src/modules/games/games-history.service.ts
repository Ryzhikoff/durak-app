/**
 * Phase 7A — Postgres-backed read service for finished games.
 *
 * Pure data: this module never talks to Redis or the engine. The HTTP
 * controller calls into here for `/api/games` (list) + `/api/games/:id`
 * (detail) once a game has been finalized.
 */

import { Injectable } from '@nestjs/common';
import type {
  GameDetail,
  GameListResponse,
  GameParticipantPublic,
  GameSummary,
  LobbySettings,
} from '@durak/shared-types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Subset of Prisma's surface we touch. Kept loose so the controller specs
 * can stub it without dragging in Prisma's generated types.
 */
export interface GamesHistoryPrismaSlice {
  game: {
    count(args: { where?: Record<string, unknown> }): Promise<number>;
    findMany(args: Record<string, unknown>): Promise<RawGame[]>;
    findUnique(args: { where: { id: string }; include: unknown }): Promise<RawGameDetail | null>;
  };
}

interface RawParticipant {
  userId: string;
  nicknameSnapshot: string;
  avatarUrlSnapshot: string | null;
  place: number;
  isWinner: boolean;
  isLoser: boolean;
}

interface RawGame {
  id: string;
  settingsJson: unknown;
  startedAt: Date;
  finishedAt: Date;
  durationSec: number;
  loserId: string | null;
  totalBouts: number;
  participants: RawParticipant[];
}

interface RawGameDetail extends RawGame {
  participants: Array<
    RawParticipant & {
      id: string;
      seatIndex: number;
      muBefore: number;
      sigmaBefore: number;
      muAfter: number;
      sigmaAfter: number;
      deltaDisplay: number;
      attacksMade: number;
      beatsMade: number;
      translatesMade: number;
      takesAsked: number;
      cardsTaken: number;
      boutsAttacked: number;
      boutsDefended: number;
      cheatAttemptedTotal: number;
      cheatCaught: number;
      cheatEscaped: number;
      noticesIssued: number;
      noticesCorrect: number;
      noticesWrong: number;
    }
  >;
}

@Injectable()
export class GamesHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Paginated list of finished games, optionally filtered by participant. */
  async list(opts: { page: number; limit: number; playerId?: string }): Promise<GameListResponse> {
    const skip = (opts.page - 1) * opts.limit;
    const prisma = this.prisma as unknown as GamesHistoryPrismaSlice;
    let total: number;
    let games: RawGame[];
    if (opts.playerId) {
      // Filter via participant relation. We need games where THIS user is a
      // participant; easier to query the participant table directly then load
      // each game with its full participants list.
      const [count, rows] = await Promise.all([
        prisma.game.count({
          where: { participants: { some: { userId: opts.playerId } } },
        }),
        prisma.game.findMany({
          where: { participants: { some: { userId: opts.playerId } } },
          orderBy: { finishedAt: 'desc' },
          take: opts.limit,
          skip,
          include: {
            participants: {
              select: {
                userId: true,
                nicknameSnapshot: true,
                avatarUrlSnapshot: true,
                place: true,
                isWinner: true,
                isLoser: true,
              },
              orderBy: { place: 'asc' },
            },
          },
        }),
      ]);
      total = count;
      games = rows;
    } else {
      const [count, rows] = await Promise.all([
        prisma.game.count({}),
        prisma.game.findMany({
          orderBy: { finishedAt: 'desc' },
          take: opts.limit,
          skip,
          include: {
            participants: {
              select: {
                userId: true,
                nicknameSnapshot: true,
                avatarUrlSnapshot: true,
                place: true,
                isWinner: true,
                isLoser: true,
              },
              orderBy: { place: 'asc' },
            },
          },
        }),
      ]);
      total = count;
      games = rows;
    }
    return {
      items: games.map((g) => toSummary(g)),
      total,
      page: opts.page,
      limit: opts.limit,
    };
  }

  /** Fetch one finished game with full per-participant metrics. */
  async getDetail(gameId: string): Promise<GameDetail | null> {
    const prisma = this.prisma as unknown as GamesHistoryPrismaSlice;
    const g = await prisma.game.findUnique({
      where: { id: gameId },
      include: {
        participants: {
          orderBy: { seatIndex: 'asc' },
        },
      },
    });
    if (!g) return null;
    const detail = g as RawGameDetail;
    const participants: GameParticipantPublic[] = detail.participants.map((p) => ({
      userId: p.userId,
      nickname: p.nicknameSnapshot,
      avatarUrl: p.avatarUrlSnapshot,
      seatIndex: p.seatIndex,
      place: p.place,
      isWinner: p.isWinner,
      isLoser: p.isLoser,
      muBefore: p.muBefore,
      sigmaBefore: p.sigmaBefore,
      muAfter: p.muAfter,
      sigmaAfter: p.sigmaAfter,
      deltaDisplay: p.deltaDisplay,
      metrics: {
        attacksMade: p.attacksMade,
        beatsMade: p.beatsMade,
        translatesMade: p.translatesMade,
        takesAsked: p.takesAsked,
        cardsTaken: p.cardsTaken,
        boutsAttacked: p.boutsAttacked,
        boutsDefended: p.boutsDefended,
        cheatAttemptedTotal: p.cheatAttemptedTotal,
        cheatCaught: p.cheatCaught,
        cheatEscaped: p.cheatEscaped,
        noticesIssued: p.noticesIssued,
        noticesCorrect: p.noticesCorrect,
        noticesWrong: p.noticesWrong,
      },
    }));
    return {
      id: detail.id,
      settings: detail.settingsJson as LobbySettings,
      startedAt: detail.startedAt.toISOString(),
      finishedAt: detail.finishedAt.toISOString(),
      durationSec: detail.durationSec,
      loserId: detail.loserId,
      totalBouts: detail.totalBouts,
      participants,
    };
  }

  /** Last-N finished games for a single participant, for profile cards. */
  async listLastForUser(userId: string, limit: number): Promise<GameSummary[]> {
    const result = await this.list({ page: 1, limit, playerId: userId });
    return result.items;
  }
}

function toSummary(g: RawGame): GameSummary {
  const settings = g.settingsJson as LobbySettings;
  return {
    id: g.id,
    startedAt: g.startedAt.toISOString(),
    endedAt: g.finishedAt.toISOString(),
    finishedAt: g.finishedAt.toISOString(),
    durationSec: g.durationSec,
    loserId: g.loserId,
    totalBouts: g.totalBouts,
    playerCount: g.participants.length,
    settings,
    players: g.participants.map((p) => ({
      id: p.userId,
      nickname: p.nicknameSnapshot,
      avatarUrl: p.avatarUrlSnapshot,
      place: p.place,
      isWinner: p.isWinner,
      isLoser: p.isLoser,
    })),
  };
}
