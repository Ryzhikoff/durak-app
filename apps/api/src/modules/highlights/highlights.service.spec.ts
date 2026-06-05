import { describe, it, expect } from 'vitest';
import {
  HighlightsService,
  type GroupBySumRow,
  type IHighlightsPrismaClient,
  type UserSnapshot,
} from './highlights.service';

const NOW = new Date('2026-06-05T12:00:00Z');

interface StubConfig {
  /**
   * `data[<field>]` provides rows for category queries keyed by metric:
   * - `cheatCaught`, `cheatEscaped`, `noticesCorrect`, `translatesMade`
   * - `winners`, `losers` → returned for the `_count` queries
   * - `totals` → returned for the bare `_count` query used by no-loss
   */
  rows: {
    cheatCaught?: GroupBySumRow[];
    cheatEscaped?: GroupBySumRow[];
    noticesCorrect?: GroupBySumRow[];
    translatesMade?: GroupBySumRow[];
    winners?: GroupBySumRow[];
    losers?: GroupBySumRow[];
    totals?: GroupBySumRow[];
  };
  users: UserSnapshot[];
}

/**
 * Build a stub Prisma client that routes groupBy calls to the right slot in
 * the `cfg.rows` map based on the shape of the `args` we receive. We keep it
 * minimal — only what the service actually invokes.
 */
function makeStub(cfg: StubConfig): IHighlightsPrismaClient {
  return {
    gameParticipant: {
      groupBy: async (args) => {
        if (args._sum) {
          const keys = Object.keys(args._sum);
          if (keys.includes('cheatCaught')) return cfg.rows.cheatCaught ?? [];
          if (keys.includes('cheatEscaped')) return cfg.rows.cheatEscaped ?? [];
          if (keys.includes('noticesCorrect')) return cfg.rows.noticesCorrect ?? [];
          if (keys.includes('translatesMade')) return cfg.rows.translatesMade ?? [];
          return [];
        }
        if (args._count) {
          if (args.where.isWinner === true) return cfg.rows.winners ?? [];
          if (args.where.isLoser === true) return cfg.rows.losers ?? [];
          return cfg.rows.totals ?? [];
        }
        return [];
      },
    },
    user: {
      findMany: async ({ where }) => {
        const wanted = new Set(where.id.in);
        return cfg.users.filter((u) => wanted.has(u.id));
      },
    },
  };
}

function user(id: string, nickname: string, avatarUrl: string | null = null): UserSnapshot {
  return { id, nickname, avatarUrl };
}

describe('HighlightsService.compute', () => {
  it('returns empty items when nothing happened', async () => {
    const stub = makeStub({ rows: {}, users: [] });
    const res = await HighlightsService.compute(stub, { now: NOW });
    expect(res.items).toEqual([]);
  });

  it('builds cheater_day and cheater_week from cheatCaught sums', async () => {
    const stub = makeStub({
      rows: {
        cheatCaught: [
          { userId: 'a', _sum: { cheatCaught: 3 } },
          { userId: 'b', _sum: { cheatCaught: 5 } },
          { userId: 'c', _sum: { cheatCaught: 0 } },
          { userId: 'd', _sum: { cheatCaught: 1 } },
        ],
      },
      users: [user('a', 'Anna'), user('b', 'Bob'), user('c', 'Cara'), user('d', 'Dan')],
    });
    const res = await HighlightsService.compute(stub, { now: NOW });
    const cheaterDay = res.items.find((i) => i.id === 'cheater_day');
    expect(cheaterDay).toBeDefined();
    expect(cheaterDay?.entries.map((e) => e.userId)).toEqual(['b', 'a', 'd']);
    expect(cheaterDay?.entries[0]?.value).toBe(5);
    expect(cheaterDay?.category).toBe('cheating');
    expect(cheaterDay?.period).toBe('day');
    // Zero-value rows are filtered out: only a/b/d appear.
    expect(cheaterDay?.entries.find((e) => e.userId === 'c')).toBeUndefined();
  });

  it('drops a category that has no positive entries', async () => {
    const stub = makeStub({
      rows: {
        cheatCaught: [{ userId: 'a', _sum: { cheatCaught: 0 } }],
      },
      users: [user('a', 'Anna')],
    });
    const res = await HighlightsService.compute(stub, { now: NOW });
    // No category should be present — every row had a zero value.
    expect(res.items).toEqual([]);
  });

  it('builds winner_day and winner_week from winner counts', async () => {
    const stub = makeStub({
      rows: {
        winners: [
          { userId: 'a', _count: { _all: 4 } },
          { userId: 'b', _count: { _all: 2 } },
        ],
      },
      users: [user('a', 'Anna'), user('b', 'Bob')],
    });
    const res = await HighlightsService.compute(stub, { now: NOW });
    const winnerDay = res.items.find((i) => i.id === 'winner_day');
    expect(winnerDay).toBeDefined();
    expect(winnerDay?.entries.map((e) => e.userId)).toEqual(['a', 'b']);
    expect(winnerDay?.entries[0]?.value).toBe(4);
    expect(winnerDay?.category).toBe('wins');
  });

  it('builds dunce_week from loser counts', async () => {
    const stub = makeStub({
      rows: { losers: [{ userId: 'l', _count: { _all: 3 } }] },
      users: [user('l', 'Loser')],
    });
    const res = await HighlightsService.compute(stub, { now: NOW });
    const dunce = res.items.find((i) => i.id === 'dunce_week');
    expect(dunce).toBeDefined();
    expect(dunce?.entries[0]?.userId).toBe('l');
    expect(dunce?.entries[0]?.value).toBe(3);
    expect(dunce?.category).toBe('losses');
  });

  it('builds sheriff_week / sneaky_week / translator_week from sums', async () => {
    const stub = makeStub({
      rows: {
        noticesCorrect: [{ userId: 's', _sum: { noticesCorrect: 4 } }],
        cheatEscaped: [{ userId: 'x', _sum: { cheatEscaped: 2 } }],
        translatesMade: [{ userId: 't', _sum: { translatesMade: 7 } }],
      },
      users: [user('s', 'Sheriff'), user('x', 'Sneaky'), user('t', 'Trans')],
    });
    const res = await HighlightsService.compute(stub, { now: NOW });
    expect(res.items.find((i) => i.id === 'sheriff_week')?.entries[0]?.userId).toBe('s');
    expect(res.items.find((i) => i.id === 'sneaky_week')?.entries[0]?.userId).toBe('x');
    expect(res.items.find((i) => i.id === 'translator_week')?.entries[0]?.userId).toBe('t');
  });

  it('qualifies no_loss only when games >= min and losses === 0', async () => {
    const stub = makeStub({
      rows: {
        // Day window: min 3 games, zero losses.
        // a: 5 games, 0 losses → qualifies, value=5
        // b: 4 games, 1 loss   → disqualified
        // c: 2 games, 0 losses → disqualified (under day min)
        totals: [
          { userId: 'a', _count: { _all: 5 } },
          { userId: 'b', _count: { _all: 4 } },
          { userId: 'c', _count: { _all: 2 } },
        ],
        losers: [{ userId: 'b', _count: { _all: 1 } }],
      },
      users: [user('a', 'Anna'), user('b', 'Bob'), user('c', 'Cara')],
    });
    const res = await HighlightsService.compute(stub, { now: NOW });
    const noLossDay = res.items.find((i) => i.id === 'no_loss_day');
    expect(noLossDay).toBeDefined();
    expect(noLossDay?.entries.map((e) => e.userId)).toEqual(['a']);
    expect(noLossDay?.entries[0]?.value).toBe(5);
    expect(noLossDay?.category).toBe('streak');
  });

  it('week no-loss requires 5+ games', async () => {
    const stub = makeStub({
      rows: {
        // Same totals/losers for week (min 5):
        // a (5,0) qualifies, b (4,1) no, c (2,0) no
        totals: [
          { userId: 'a', _count: { _all: 5 } },
          { userId: 'b', _count: { _all: 4 } },
        ],
        losers: [],
      },
      users: [user('a', 'Anna'), user('b', 'Bob')],
    });
    const res = await HighlightsService.compute(stub, { now: NOW });
    const noLossWeek = res.items.find((i) => i.id === 'no_loss_week');
    expect(noLossWeek?.entries.map((e) => e.userId)).toEqual(['a']);
    // Day stub uses the same totals; both windows pull from the same stub
    // bucket — that's a stub simplification, the real Prisma would scope by
    // finishedAt. We just assert week-min cutoff drops 4-game `b`.
  });

  it('drops entries when user is missing from the snapshot', async () => {
    const stub = makeStub({
      rows: {
        cheatCaught: [
          { userId: 'a', _sum: { cheatCaught: 5 } },
          { userId: 'ghost', _sum: { cheatCaught: 3 } },
        ],
      },
      users: [user('a', 'Anna')],
    });
    const res = await HighlightsService.compute(stub, { now: NOW });
    const cheaterDay = res.items.find((i) => i.id === 'cheater_day');
    expect(cheaterDay?.entries.map((e) => e.userId)).toEqual(['a']);
  });

  it('caps each highlight to TOP 3', async () => {
    const stub = makeStub({
      rows: {
        cheatCaught: [
          { userId: 'a', _sum: { cheatCaught: 1 } },
          { userId: 'b', _sum: { cheatCaught: 2 } },
          { userId: 'c', _sum: { cheatCaught: 3 } },
          { userId: 'd', _sum: { cheatCaught: 4 } },
          { userId: 'e', _sum: { cheatCaught: 5 } },
        ],
      },
      users: [user('a', 'A'), user('b', 'B'), user('c', 'C'), user('d', 'D'), user('e', 'E')],
    });
    const res = await HighlightsService.compute(stub, { now: NOW });
    const cheaterDay = res.items.find((i) => i.id === 'cheater_day');
    expect(cheaterDay?.entries.map((e) => e.userId)).toEqual(['e', 'd', 'c']);
  });
});
