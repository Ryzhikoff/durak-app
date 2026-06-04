import { describe, expect, it } from 'vitest';
import { sortHandStrongLeft } from './handSort';
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
