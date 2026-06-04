/**
 * Pure hand-sorting helper. Strong cards go LEFT.
 *
 *  1. Jokers first (left), red before black.
 *  2. Trumps next, rank descending (Ace → 6).
 *  3. Other suits last, rank descending; within the same rank, suit order
 *     hearts → diamonds → clubs (alphabetical-ish, excluding trump suit which
 *     would already have been grouped above).
 *
 * The function is pure — it returns a new array and never mutates input.
 */
import type { Card, Suit } from './types';

const NON_TRUMP_SUIT_ORDER: Record<Suit, number> = {
  hearts: 0,
  diamonds: 1,
  clubs: 2,
  spades: 3,
};

export function sortHandStrongLeft(
  hand: readonly Card[],
  trumpSuit: Suit | null,
): Card[] {
  const bucket = (c: Card): number => {
    if (c.kind === 'joker') return 0;
    if (trumpSuit !== null && c.suit === trumpSuit) return 1;
    return 2;
  };
  return [...hand].sort((a, b) => {
    const ba = bucket(a);
    const bb = bucket(b);
    if (ba !== bb) return ba - bb;

    // Both jokers: red before black.
    if (a.kind === 'joker' && b.kind === 'joker') {
      if (a.color === b.color) return 0;
      return a.color === 'red' ? -1 : 1;
    }

    // Both standard.
    if (a.kind === 'standard' && b.kind === 'standard') {
      // Rank descending (strong → weak).
      if (a.rank !== b.rank) return b.rank - a.rank;
      // Within same rank for non-trump bucket only: stable suit ordering.
      if (ba === 2) {
        const sa = NON_TRUMP_SUIT_ORDER[a.suit];
        const sb = NON_TRUMP_SUIT_ORDER[b.suit];
        if (sa !== sb) return sa - sb;
      }
      return 0;
    }
    return 0;
  });
}
