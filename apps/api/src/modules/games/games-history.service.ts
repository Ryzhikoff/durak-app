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
  SameCompositionResponse,
} from '@durak/shared-types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** Hard ceiling on `listSameComposition` to keep payloads predictable. */
export const SAME_COMPOSITION_MAX_LIMIT = 50;
/** Default `limit` for same-composition queries when callers omit it. */
export const SAME_COMPOSITION_DEFAULT_LIMIT = 20;

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
  /**
   * Raw SQL escape hatch used by {@link GamesHistoryService.listSameComposition}.
   * The tagged-template typing is awkward to mirror exactly; we keep it loose
   * so the service spec can stub it cheaply.
   */
  $queryRaw?: (...args: unknown[]) => Promise<Array<{ id: string }>>;
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

  /**
   * Phase 7B — list finished games where the participant set equals exactly
   * the participant set of `referenceGameId` (same number of distinct userIds
   * and same identities). Sorted by `finishedAt DESC`. Excludes the reference
   * game itself.
   *
   * Returns `null` if the reference game is not a finished game in Postgres
   * (active or unknown). Callers translate that to a 404.
   */
  async listSameComposition(
    referenceGameId: string,
    limitInput: number,
  ): Promise<SameCompositionResponse | null> {
    const prisma = this.prisma as unknown as GamesHistoryPrismaSlice;
    const ref = await prisma.game.findUnique({
      where: { id: referenceGameId },
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
        },
      },
    });
    if (!ref) return null;

    const targetUserIds = Array.from(new Set(ref.participants.map((p) => p.userId))).sort();
    const limit = Math.min(Math.max(1, Math.floor(limitInput)), SAME_COMPOSITION_MAX_LIMIT);

    // Find game ids where the DISTINCT participant userId set, sorted asc,
    // matches the reference set exactly. We rely on Postgres array_agg for the
    // set comparison so the DB does the heavy lifting and we only round-trip
    // ids back. `array_agg(DISTINCT ... ORDER BY ...)` yields a stable form
    // that equality against a text[] literal can match against.
    // $queryRaw must be invoked as a method on the Prisma client — extracting
    // it into a local variable strips the `this` binding and Prisma loses
    // access to its internal _createPrismaPromise factory.
    const rawPrisma = this.prisma as unknown as {
      $queryRaw: <T = unknown>(q: Prisma.Sql) => Promise<T>;
    };
    const rows = await rawPrisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT g.id
      FROM "Game" g
      WHERE g.id <> ${referenceGameId}
        AND (
          SELECT array_agg(DISTINCT gp."userId" ORDER BY gp."userId")
          FROM "GameParticipant" gp
          WHERE gp."gameId" = g.id
        ) = ${targetUserIds}::text[]
      ORDER BY g."finishedAt" DESC
      LIMIT ${limit}
    `);
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) {
      return { items: [], total: 0 };
    }
    const games = await prisma.game.findMany({
      where: { id: { in: ids } },
      orderBy: { finishedAt: 'desc' },
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
    });
    return {
      items: games.map((g) => toSummary(g)),
      total: games.length,
    };
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
