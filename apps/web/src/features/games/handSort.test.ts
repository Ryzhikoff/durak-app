import { describe, expect, it } from 'vitest';
import { sortHand, sortHandBySuit, sortHandStrongLeft } from './handSort';
import type { Card, Rank } from './types';

const s = (id: string, suit: 'spades' | 'hearts' | 'diamonds' | 'clubs', rank: Rank): Card => ({
  kind: 'standard',
  id,
  suit,
  rank,
});

const j = (id: string, color: 'red' | 'black'): Card => ({
  kind: 'joker',
  id,
  color,
});

describe('sortHandStrongLeft', () => {
  it('keeps jokers first (red before black) regardless of input order', () => {
    const out = sortHandStrongLeft(
      [
        s('a', 'spades', 6),
        j('jb', 'black'),
        j('jr', 'red'),
        s('b', 'hearts', 14),
      ],
      'hearts',
    );
    expect(out.map((c) => c.id)).toEqual(['jr', 'jb', 'b', 'a']);
  });

  it('puts trumps after jokers and before non-trumps, ranks descending', () => {
    // Trump = spades. Trumps go first (ranks desc), then non-trumps (ranks
    // desc, then suit order hearts → diamonds → clubs → spades).
    const out = sortHandStrongLeft(
      [
        s('a', 'hearts', 10), // non-trump 10
        s('b', 'spades', 9), // trump 9
        s('c', 'spades', 14), // trump A
        s('d', 'clubs', 12), // non-trump 12
        s('e', 'spades', 11), // trump J
      ],
      'spades',
    );
    expect(out.map((c) => c.id)).toEqual(['c', 'e', 'b', 'd', 'a']);
  });

  it('orders non-trumps by rank desc, then by suit hearts→diamonds→clubs→spades', () => {
    // Trump = jokers-only (null). All cards behave as non-trump and order by
    // rank desc; within same rank: hearts < diamonds < clubs < spades.
    const out = sortHandStrongLeft(
      [
        s('a', 'clubs', 10),
        s('b', 'hearts', 10),
        s('c', 'spades', 10),
        s('d', 'diamonds', 10),
        s('e', 'spades', 6),
      ],
      null,
    );
    expect(out.map((c) => c.id)).toEqual(['b', 'd', 'a', 'c', 'e']);
  });

  it('does not mutate the input array', () => {
    const input: Card[] = [
      s('a', 'hearts', 10),
      s('b', 'spades', 6),
    ];
    const snapshot = input.slice();
    sortHandStrongLeft(input, 'hearts');
    expect(input).toEqual(snapshot);
  });
});

describe('sortHandBySuit', () => {
  it('keeps jokers first (red before black) regardless of input order', () => {
    // Trump = hearts. Jokers come out first, then trumps DESC, then non-trumps
    // grouped clubs → diamonds → spades (hearts excluded as trump).
    const out = sortHandBySuit(
      [
        s('a', 'spades', 6),
        j('jb', 'black'),
        j('jr', 'red'),
        s('b', 'hearts', 14),
      ],
      'hearts',
    );
    expect(out.map((c) => c.id)).toEqual(['jr', 'jb', 'b', 'a']);
  });

  it('puts trumps DESC after jokers and before non-trump groups', () => {
    // Trump = spades. Trumps go DESC (A → 9), then non-trumps grouped
    // (clubs → diamonds → hearts) ASC inside each group; spades excluded
    // from the non-trump buckets because they're the trump.
    const out = sortHandBySuit(
      [
        s('h10', 'hearts', 10), // non-trump hearts 10
        s('s9', 'spades', 9), // trump 9
        s('sA', 'spades', 14), // trump A
        s('c12', 'clubs', 12), // non-trump clubs Q
        s('sJ', 'spades', 11), // trump J
        s('c6', 'clubs', 6), // non-trump clubs 6
        s('d8', 'diamonds', 8), // non-trump diamonds 8
      ],
      'spades',
    );
    // Trumps: A, J, 9. Non-trumps: clubs ASC (6, 12), diamonds (8), hearts (10).
    expect(out.map((c) => c.id)).toEqual(['sA', 'sJ', 's9', 'c6', 'c12', 'd8', 'h10']);
  });

  it('groups non-trumps by suit (clubs → diamonds → hearts → spades) and ASC inside each', () => {
    // No trump suit (jokers-only deck modelled by null). All standard cards
    // go through the non-trump path.
    const out = sortHandBySuit(
      [
        s('h10', 'hearts', 10),
        s('c6', 'clubs', 6),
        s('s14', 'spades', 14),
        s('c14', 'clubs', 14),
        s('d8', 'diamonds', 8),
        s('h6', 'hearts', 6),
        s('s6', 'spades', 6),
        s('d14', 'diamonds', 14),
      ],
      null,
    );
    expect(out.map((c) => c.id)).toEqual([
      'c6', 'c14', // clubs ASC
      'd8', 'd14', // diamonds ASC
      'h6', 'h10', // hearts ASC
      's6', 's14', // spades ASC
    ]);
  });

  it('does not mutate the input array', () => {
    const input: Card[] = [
      s('a', 'hearts', 10),
      s('b', 'spades', 6),
    ];
    const snapshot = input.slice();
    sortHandBySuit(input, 'hearts');
    expect(input).toEqual(snapshot);
  });
});

describe('sortHand dispatcher', () => {
  it('routes "suit" to sortHandBySuit', () => {
    const hand: Card[] = [
      s('c6', 'clubs', 6),
      s('cA', 'clubs', 14),
      s('d6', 'diamonds', 6),
    ];
    expect(sortHand(hand, null, 'suit').map((c) => c.id)).toEqual([
      'c6',
      'cA',
      'd6',
    ]);
  });

  it('routes "power" (and undefined) to sortHandStrongLeft', () => {
    const hand: Card[] = [
      s('c6', 'clubs', 6),
      s('cA', 'clubs', 14),
      s('d6', 'diamonds', 6),
    ];
    // Power mode: rank DESC dominates, so Ace comes first regardless of suit.
    expect(sortHand(hand, null, 'power').map((c) => c.id)).toEqual([
      'cA',
      'd6',
      'c6',
    ]);
    expect(sortHand(hand, null, undefined).map((c) => c.id)).toEqual([
      'cA',
      'd6',
      'c6',
    ]);
  });
});
