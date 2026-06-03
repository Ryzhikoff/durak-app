import { describe, expect, it } from 'vitest';
import { DefaultTrumpSelector } from '../src/strategies/trump.js';
import {
  LowestTrumpFirstPlayer,
  RandomFirstPlayer,
  PreviousLoserFirstPlayer,
} from '../src/strategies/first-player.js';
import { AllPlayersPolicy, AttackerOnlyPolicy } from '../src/strategies/attack-policy.js';
import { DefaultFirstBoutLimit } from '../src/strategies/first-bout-limit.js';
import { DefaultCheatPolicy } from '../src/strategies/cheat-policy.js';
import { StandardDealStrategy } from '../src/strategies/deal.js';
import { IdentityRatingCalculator } from '../src/strategies/rating.js';
import { card, joker, makeGame, makeSettings } from '../src/_testing/fixtures.js';
import { createRng } from '../src/rng.js';
import type { Player } from '../src/types.js';

const trumpSelector = new DefaultTrumpSelector();

describe('DefaultTrumpSelector', () => {
  it('selects the first (bottom) non-joker card', () => {
    const deck = [card('hearts', 9), card('spades', 7), card('clubs', 14)];
    const sel = trumpSelector.select(deck);
    expect(sel.trumpSuit).toBe('hearts');
    expect(sel.trumpCard?.id).toBe('hearts-9');
  });

  it('skips jokers when picking trump', () => {
    const deck = [joker('red'), joker('black'), card('spades', 7)];
    const sel = trumpSelector.select(deck);
    expect(sel.trumpSuit).toBe('spades');
    expect(sel.trumpCard?.id).toBe('spades-7');
  });

  it('falls back to clubs / null trump card when deck is all jokers', () => {
    const sel = trumpSelector.select([joker('red'), joker('black')]);
    expect(sel.trumpSuit).toBe('clubs');
    expect(sel.trumpCard).toBeNull();
  });
});

describe('LowestTrumpFirstPlayer', () => {
  it('picks player with lowest trump', () => {
    const players: Player[] = [
      { id: 'p1', nickname: 'A', hand: [card('spades', 11), card('hearts', 6)] },
      { id: 'p2', nickname: 'B', hand: [card('spades', 6), card('clubs', 14)] },
      { id: 'p3', nickname: 'C', hand: [card('hearts', 14), card('clubs', 6)] },
    ];
    const winner = new LowestTrumpFirstPlayer().pick({
      players,
      trumpSuit: 'spades',
      previousLoserId: null,
      rng: createRng(0),
    });
    expect(winner).toBe('p2');
  });

  it('falls back to first player when nobody has trumps', () => {
    const players: Player[] = [
      { id: 'p1', nickname: 'A', hand: [card('hearts', 7)] },
      { id: 'p2', nickname: 'B', hand: [card('clubs', 14)] },
    ];
    const winner = new LowestTrumpFirstPlayer().pick({
      players,
      trumpSuit: 'spades',
      previousLoserId: null,
      rng: createRng(0),
    });
    expect(winner).toBe('p1');
  });
});

describe('RandomFirstPlayer', () => {
  it('returns same player for same seed', () => {
    const players: Player[] = [
      { id: 'p1', nickname: 'A', hand: [] },
      { id: 'p2', nickname: 'B', hand: [] },
      { id: 'p3', nickname: 'C', hand: [] },
    ];
    const a = new RandomFirstPlayer().pick({
      players,
      trumpSuit: 'spades',
      previousLoserId: null,
      rng: createRng(123),
    });
    const b = new RandomFirstPlayer().pick({
      players,
      trumpSuit: 'spades',
      previousLoserId: null,
      rng: createRng(123),
    });
    expect(a).toBe(b);
  });
});

describe('PreviousLoserFirstPlayer', () => {
  it('returns previousLoserId when present in seats', () => {
    const players: Player[] = [
      { id: 'p1', nickname: 'A', hand: [card('spades', 6)] },
      { id: 'p2', nickname: 'B', hand: [card('spades', 14)] },
    ];
    const winner = new PreviousLoserFirstPlayer().pick({
      players,
      trumpSuit: 'spades',
      previousLoserId: 'p2',
      rng: createRng(0),
    });
    expect(winner).toBe('p2');
  });

  it('falls back to lowest_trump when previous loser is not seated', () => {
    const players: Player[] = [
      { id: 'p1', nickname: 'A', hand: [card('spades', 6)] },
      { id: 'p2', nickname: 'B', hand: [card('spades', 14)] },
    ];
    const winner = new PreviousLoserFirstPlayer().pick({
      players,
      trumpSuit: 'spades',
      previousLoserId: 'p999',
      rng: createRng(0),
    });
    expect(winner).toBe('p1'); // lowest trump
  });

  it('falls back to lowest_trump when previousLoserId is null (first game)', () => {
    const players: Player[] = [
      { id: 'p1', nickname: 'A', hand: [card('spades', 13)] },
      { id: 'p2', nickname: 'B', hand: [card('spades', 7)] },
    ];
    const winner = new PreviousLoserFirstPlayer().pick({
      players,
      trumpSuit: 'spades',
      previousLoserId: null,
      rng: createRng(0),
    });
    expect(winner).toBe('p2'); // lowest trump fallback
  });
});

describe('AttackerOnlyPolicy / AllPlayersPolicy', () => {
  const game = makeGame({ settings: { attackerScope: 'all' } });

  it('AttackerOnlyPolicy permits only the attacker', () => {
    const policy = new AttackerOnlyPolicy();
    const attackerId = game.players[game.currentAttackerIndex].id;
    const defenderId = game.players[game.currentDefenderIndex].id;
    const other = game.players.find((p) => p.id !== attackerId && p.id !== defenderId);
    expect(policy.canThrow(game, attackerId)).toBe(true);
    expect(policy.canThrow(game, defenderId)).toBe(false);
    expect(policy.canThrow(game, other!.id)).toBe(false);
  });

  it('AllPlayersPolicy permits non-defender non-finished players', () => {
    const policy = new AllPlayersPolicy();
    const defenderId = game.players[game.currentDefenderIndex].id;
    for (const p of game.players) {
      expect(policy.canThrow(game, p.id)).toBe(p.id !== defenderId);
    }
  });
});

describe('DefaultFirstBoutLimit', () => {
  it('returns 5 when first bout limit is 5', () => {
    const game = makeGame({ settings: { firstBoutLimit: 5 } });
    expect(new DefaultFirstBoutLimit().limit(game)).toBe(5);
  });

  it('returns 6 when first bout limit is 6', () => {
    const game = makeGame({ settings: { firstBoutLimit: 6 } });
    expect(new DefaultFirstBoutLimit().limit(game)).toBe(6);
  });

  it('returns initialDefenderHandSize for defender_hand', () => {
    const game = makeGame({ settings: { firstBoutLimit: 'defender_hand' } });
    expect(new DefaultFirstBoutLimit().limit(game)).toBe(game.initialDefenderHandSize);
  });

  it('falls back to 6 from bout 2 onwards', () => {
    const game = makeGame({ settings: { firstBoutLimit: 5 } });
    expect(new DefaultFirstBoutLimit().limit({ ...game, boutNumber: 2 })).toBe(6);
  });
});

describe('DefaultCheatPolicy', () => {
  const game = makeGame({
    settings: {
      cheatingEnabled: true,
      cheatAttempts: 3,
      cheatNoticeScope: 'defender_only',
    },
  });
  const defenderId = game.players[game.currentDefenderIndex].id;
  const attackerId = game.players[game.currentAttackerIndex].id;
  const other = game.players.find((p) => p.id !== defenderId && p.id !== attackerId)!;

  it('defender_only: only the defender may notice attack cheats', () => {
    const policy = new DefaultCheatPolicy();
    expect(policy.canNotice(game, defenderId, attackerId, false)).toBe(true);
    expect(policy.canNotice(game, other.id, attackerId, false)).toBe(false);
    // The cheater cannot self-notice.
    expect(policy.canNotice(game, attackerId, attackerId, false)).toBe(false);
  });

  it('defender_only: nobody may notice beat cheats (defender would self-incriminate)', () => {
    const policy = new DefaultCheatPolicy();
    // Beat-cheat: cheater is the defender. Per spec, in defender_only scope
    // nobody is on the receiving side except the defender themselves.
    expect(policy.canNotice(game, attackerId, defenderId, true)).toBe(false);
    expect(policy.canNotice(game, other.id, defenderId, true)).toBe(false);
    expect(policy.canNotice(game, defenderId, defenderId, true)).toBe(false);
  });

  it('all-scope allows everyone except the cheater to notice', () => {
    const policy = new DefaultCheatPolicy();
    const allScope = { ...game, settings: { ...game.settings, cheatNoticeScope: 'all' as const } };
    expect(policy.canNotice(allScope, other.id, attackerId, false)).toBe(true);
    expect(policy.canNotice(allScope, defenderId, attackerId, false)).toBe(true);
    // The cheater themselves still can't notice.
    expect(policy.canNotice(allScope, attackerId, attackerId, false)).toBe(false);
    // For beat-cheats in all-scope: everyone except cheater (the defender)
    // can notice — including the attacker.
    expect(policy.canNotice(allScope, attackerId, defenderId, true)).toBe(true);
    expect(policy.canNotice(allScope, other.id, defenderId, true)).toBe(true);
    expect(policy.canNotice(allScope, defenderId, defenderId, true)).toBe(false);
  });

  it('disabled cheating denies everyone', () => {
    const policy = new DefaultCheatPolicy();
    const disabled = {
      ...game,
      settings: { ...game.settings, cheatingEnabled: false },
    };
    expect(policy.canNotice(disabled, defenderId, attackerId, false)).toBe(false);
  });
});

describe('StandardDealStrategy', () => {
  it('deals N cards to each player', () => {
    const deck = Array.from({ length: 36 }, (_, i) =>
      i < 9
        ? card('spades', (6 + i) as 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14)
        : i < 18
          ? card('hearts', (6 + (i - 9)) as 6)
          : i < 27
            ? card('diamonds', (6 + (i - 18)) as 6)
            : card('clubs', (6 + (i - 27)) as 6),
    );
    const result = new StandardDealStrategy().deal(
      deck,
      [
        { id: 'p1', nickname: 'A' },
        { id: 'p2', nickname: 'B' },
      ],
      6,
    );
    expect(result.hands['p1']).toHaveLength(6);
    expect(result.hands['p2']).toHaveLength(6);
    expect(result.deck).toHaveLength(deck.length - 12);
  });
});

describe('IdentityRatingCalculator', () => {
  it('returns inputs unchanged', () => {
    const calc = new IdentityRatingCalculator();
    const input = [
      { playerId: 'a', mu: 25, sigma: 8, place: 1 },
      { playerId: 'b', mu: 25, sigma: 8, place: 2 },
    ];
    const out = calc.apply(input);
    expect(out).toEqual([
      { playerId: 'a', mu: 25, sigma: 8 },
      { playerId: 'b', mu: 25, sigma: 8 },
    ]);
  });
});

// Reference setting referenced above
void makeSettings();
