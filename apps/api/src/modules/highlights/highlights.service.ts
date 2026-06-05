import { Injectable, Logger } from '@nestjs/common';
import type {
  Highlight,
  HighlightCategory,
  HighlightEntry,
  HighlightPeriod,
  HighlightsResponse,
} from '@durak/shared-types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';

/** Top-N cut applied to every highlight category. */
const TOP_N = 3;
/** Period windows in ms. */
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
/** Redis cache TTL for the full response. */
export const HIGHLIGHTS_CACHE_KEY = 'highlights:cache';
export const HIGHLIGHTS_CACHE_TTL_SECONDS = 300;
/** Minimum games to qualify for "no loss" categories. */
const NO_LOSS_MIN_GAMES_DAY = 3;
const NO_LOSS_MIN_GAMES_WEEK = 5;

/**
 * Row shape returned by Prisma `gameParticipant.groupBy({ by: ['userId'] })`
 * with the aggregations we care about. Only fields we actually request are
 * declared so test stubs stay small.
 */
export interface GroupBySumRow {
  userId: string;
  _count?: { _all: number };
  _sum?: Partial<{
    cheatCaught: number;
    cheatEscaped: number;
    noticesCorrect: number;
    translatesMade: number;
    cardsTaken: number;
    takesAsked: number;
  }>;
}

/** Profile snapshot used to enrich highlight entries. */
export interface UserSnapshot {
  id: string;
  nickname: string;
  avatarUrl: string | null;
}

/** Slimmed Prisma shape so the service can be unit-tested with stubs. */
export interface IHighlightsPrismaClient {
  gameParticipant: {
    groupBy(args: {
      by: ['userId'];
      where: {
        game: { finishedAt: { gte: Date } };
        isWinner?: boolean;
        isLoser?: boolean;
      };
      _sum?: Record<string, true>;
      _count?: { _all: true };
    }): Promise<GroupBySumRow[]>;
  };
  user: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; nickname: true; avatarUrl: true };
    }): Promise<UserSnapshot[]>;
  };
}

interface CategoryDef {
  id: string;
  category: HighlightCategory;
  period: HighlightPeriod;
  title: string;
  icon: string;
}

const CATEGORY_DEFS: Record<string, CategoryDef> = {
  cheater_day: {
    id: 'cheater_day',
    category: 'cheating',
    period: 'day',
    title: 'Жулик дня',
    icon: '\u{1F921}',
  },
  cheater_week: {
    id: 'cheater_week',
    category: 'cheating',
    period: 'week',
    title: 'Жулик недели',
    icon: '\u{1F921}',
  },
  sneaky_week: {
    id: 'sneaky_week',
    category: 'cheating',
    period: 'week',
    title: 'Хитрец недели',
    icon: '\u{1F3AD}',
  },
  sheriff_week: {
    id: 'sheriff_week',
    category: 'cheating',
    period: 'week',
    title: 'Шериф недели',
    icon: '\u{1F575}\u{FE0F}',
  },
  winner_day: {
    id: 'winner_day',
    category: 'wins',
    period: 'day',
    title: 'Победитель дня',
    icon: '\u{1F451}',
  },
  winner_week: {
    id: 'winner_week',
    category: 'wins',
    period: 'week',
    title: 'Победитель недели',
    icon: '\u{1F451}',
  },
  no_loss_day: {
    id: 'no_loss_day',
    category: 'streak',
    period: 'day',
    title: 'Без проигрышей за день',
    icon: '\u{1F6E1}\u{FE0F}',
  },
  no_loss_week: {
    id: 'no_loss_week',
    category: 'streak',
    period: 'week',
    title: 'Без проигрышей за неделю',
    icon: '\u{1F6E1}\u{FE0F}',
  },
  dunce_week: {
    id: 'dunce_week',
    category: 'losses',
    period: 'week',
    title: 'Дурак недели',
    icon: '\u{1F629}',
  },
  translator_week: {
    id: 'translator_week',
    category: 'translates',
    period: 'week',
    title: 'Переводчик недели',
    icon: '\u{1F501}',
  },
};

@Injectable()
export class HighlightsService {
  private readonly logger = new Logger(HighlightsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Public entrypoint. Caches the full response in Redis for 5 minutes. */
  async getHighlights(now: Date = new Date()): Promise<HighlightsResponse> {
    // Cache layer — best-effort. Redis flake never fails the request.
    try {
      const cached = await this.redis.client.get(HIGHLIGHTS_CACHE_KEY);
      if (cached) {
        return JSON.parse(cached) as HighlightsResponse;
      }
    } catch (err) {
      this.logger.warn({ err }, 'highlights cache read failed');
    }

    const response = await HighlightsService.compute(
      this.prisma as unknown as IHighlightsPrismaClient,
      { now },
    );

    try {
      await this.redis.client.set(
        HIGHLIGHTS_CACHE_KEY,
        JSON.stringify(response),
        'EX',
        HIGHLIGHTS_CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn({ err }, 'highlights cache write failed');
    }

    return response;
  }

  /**
   * Pure compute path. Runs every category in parallel against the supplied
   * Prisma-shaped client. Categories that come back empty are dropped from
   * the response so the UI only renders content-bearing widgets.
   */
  static async compute(
    prisma: IHighlightsPrismaClient,
    opts: { now: Date },
  ): Promise<HighlightsResponse> {
    const dayCutoff = new Date(opts.now.getTime() - DAY_MS);
    const weekCutoff = new Date(opts.now.getTime() - WEEK_MS);

    // Each category returns an Array<{ userId, value }> already capped at TOP_N
    // and free of zero-valued entries. Empty arrays drop the highlight.
    const [
      cheaterDay,
      cheaterWeek,
      sneakyWeek,
      sheriffWeek,
      winnerDay,
      winnerWeek,
      noLossDay,
      noLossWeek,
      dunceWeek,
      translatorWeek,
    ] = await Promise.all([
      topBySum(prisma, dayCutoff, 'cheatCaught'),
      topBySum(prisma, weekCutoff, 'cheatCaught'),
      topBySum(prisma, weekCutoff, 'cheatEscaped'),
      topBySum(prisma, weekCutoff, 'noticesCorrect'),
      topByWinCount(prisma, dayCutoff),
      topByWinCount(prisma, weekCutoff),
      topNoLoss(prisma, dayCutoff, NO_LOSS_MIN_GAMES_DAY),
      topNoLoss(prisma, weekCutoff, NO_LOSS_MIN_GAMES_WEEK),
      topByLossCount(prisma, weekCutoff),
      topBySum(prisma, weekCutoff, 'translatesMade'),
    ]);

    const drafts: Array<{
      defId: string;
      rows: Array<{ userId: string; value: number; valueLabel?: string }>;
    }> = [
      { defId: 'cheater_day', rows: cheaterDay },
      { defId: 'cheater_week', rows: cheaterWeek },
      { defId: 'sneaky_week', rows: sneakyWeek },
      { defId: 'sheriff_week', rows: sheriffWeek },
      { defId: 'winner_day', rows: winnerDay },
      { defId: 'winner_week', rows: winnerWeek },
      { defId: 'no_loss_day', rows: noLossDay },
      { defId: 'no_loss_week', rows: noLossWeek },
      { defId: 'dunce_week', rows: dunceWeek },
      { defId: 'translator_week', rows: translatorWeek },
    ].filter((d) => d.rows.length > 0);

    if (drafts.length === 0) {
      return { items: [] };
    }

    // Resolve all referenced users in a single round-trip.
    const userIds = Array.from(new Set(drafts.flatMap((d) => d.rows.map((r) => r.userId))));
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, nickname: true, avatarUrl: true },
    });
    const usersById = new Map(users.map((u) => [u.id, u]));

    const items: Highlight[] = drafts
      .map((draft) => {
        const def = CATEGORY_DEFS[draft.defId];
        // Defensive: a typo in the draft list would skip the highlight. With
        // the current static config this branch can't actually be taken.
        if (!def) return null;
        const entries: HighlightEntry[] = draft.rows
          .map<HighlightEntry | null>((row) => {
            const user = usersById.get(row.userId);
            if (!user) return null;
            return {
              userId: user.id,
              nickname: user.nickname,
              avatarUrl: user.avatarUrl,
              value: row.value,
              ...(row.valueLabel !== undefined && { valueLabel: row.valueLabel }),
            };
          })
          .filter((e): e is HighlightEntry => e !== null);
        if (entries.length === 0) return null;
        return {
          id: def.id,
          category: def.category,
          period: def.period,
          title: def.title,
          icon: def.icon,
          entries,
        };
      })
      .filter((h): h is Highlight => h !== null);

    return { items };
  }
}

// ---------- Internal helpers ----------

/**
 * Generic "top N users by sum of a single metric" query. Filters out rows
 * where the metric is zero (Prisma can't express a `having`-like filter
 * directly, so we post-filter).
 */
async function topBySum(
  prisma: IHighlightsPrismaClient,
  finishedAfter: Date,
  field: 'cheatCaught' | 'cheatEscaped' | 'noticesCorrect' | 'translatesMade',
): Promise<Array<{ userId: string; value: number }>> {
  const rows = await prisma.gameParticipant.groupBy({
    by: ['userId'],
    where: { game: { finishedAt: { gte: finishedAfter } } },
    _sum: { [field]: true } as Record<string, true>,
  });
  return rows
    .map((r) => ({ userId: r.userId, value: r._sum?.[field] ?? 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, TOP_N);
}

async function topByWinCount(
  prisma: IHighlightsPrismaClient,
  finishedAfter: Date,
): Promise<Array<{ userId: string; value: number }>> {
  const rows = await prisma.gameParticipant.groupBy({
    by: ['userId'],
    where: { game: { finishedAt: { gte: finishedAfter } }, isWinner: true },
    _count: { _all: true },
  });
  return rows
    .map((r) => ({ userId: r.userId, value: r._count?._all ?? 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, TOP_N);
}

async function topByLossCount(
  prisma: IHighlightsPrismaClient,
  finishedAfter: Date,
): Promise<Array<{ userId: string; value: number }>> {
  const rows = await prisma.gameParticipant.groupBy({
    by: ['userId'],
    where: { game: { finishedAt: { gte: finishedAfter } }, isLoser: true },
    _count: { _all: true },
  });
  return rows
    .map((r) => ({ userId: r.userId, value: r._count?._all ?? 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, TOP_N);
}

/**
 * "Played at least N games in the window without losing a single one."
 * Two round-trips: total games per user, then loss count per user — players
 * with games >= minGames AND losses === 0 qualify; rank by total games desc.
 */
async function topNoLoss(
  prisma: IHighlightsPrismaClient,
  finishedAfter: Date,
  minGames: number,
): Promise<Array<{ userId: string; value: number; valueLabel?: string }>> {
  const [totals, losses] = await Promise.all([
    prisma.gameParticipant.groupBy({
      by: ['userId'],
      where: { game: { finishedAt: { gte: finishedAfter } } },
      _count: { _all: true },
    }),
    prisma.gameParticipant.groupBy({
      by: ['userId'],
      where: { game: { finishedAt: { gte: finishedAfter } }, isLoser: true },
      _count: { _all: true },
    }),
  ]);
  const lossCount = new Map<string, number>();
  for (const r of losses) {
    lossCount.set(r.userId, r._count?._all ?? 0);
  }
  return totals
    .map((r) => ({
      userId: r.userId,
      games: r._count?._all ?? 0,
      losses: lossCount.get(r.userId) ?? 0,
    }))
    .filter((r) => r.games >= minGames && r.losses === 0)
    .sort((a, b) => b.games - a.games)
    .slice(0, TOP_N)
    .map((r) => ({ userId: r.userId, value: r.games }));
}
