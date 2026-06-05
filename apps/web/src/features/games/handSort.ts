/**
 * Pure hand-sorting helpers. Two strategies are supported and the active one
 * is chosen by the viewer in their profile settings (see `User.handSortMode`).
 *
 * Both strategies are pure — they return a new array and never mutate input.
 */
import type { HandSortMode } from '@durak/shared-types';
import type { Card, Suit } from './types';

export type { HandSortMode } from '@durak/shared-types';

/**
 * "Power" mode — jokers, trumps DESC, non-trumps DESC. Strongest cards left.
 *  1. Jokers first (left), red before black.
 *  2. Trumps next, rank descending (Ace → 6).
 *  3. Other suits last, rank descending; within the same rank, suit order
 *     hearts → diamonds → clubs (alphabetical-ish, excluding trump suit which
 *     would already have been grouped above).
 */
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

/**
 * "Suit" mode:
 *  1. Jokers first (red before black).
 *  2. Trumps next, rank DESC (the trump bucket itself still goes strong → weak
 *     so the user's most-valuable cards remain on the left).
 *  3. Non-trumps grouped by suit in alphabetical order — clubs → diamonds →
 *     hearts → spades — with the trump suit skipped because those cards are
 *     already in bucket (2). Inside each suit, rank ASCENDING (6 → A) so the
 *     player scans low-to-high left-to-right within a suit.
 */
const SUIT_GROUP_ORDER: Record<Suit, number> = {
  clubs: 0,
  diamonds: 1,
  hearts: 2,
  spades: 3,
};

export function sortHandBySuit(
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

    if (a.kind === 'standard' && b.kind === 'standard') {
      // Trump bucket: rank DESC (Ace → 6).
      if (ba === 1) {
        if (a.rank !== b.rank) return b.rank - a.rank;
        return 0;
      }
      // Non-trump bucket: group by suit (alphabetical), then rank ASC.
      const sa = SUIT_GROUP_ORDER[a.suit];
      const sb = SUIT_GROUP_ORDER[b.suit];
      if (sa !== sb) return sa - sb;
      if (a.rank !== b.rank) return a.rank - b.rank;
      return 0;
    }
    return 0;
  });
}

/**
 * Top-level dispatcher used by the hand renderer. Defaults to `'power'` when
 * `mode` is missing or invalid so a stale session keeps the legacy UX.
 */
export function sortHand(
  hand: readonly Card[],
  trumpSuit: Suit | null,
  mode: HandSortMode | undefined,
): Card[] {
  if (mode === 'suit') return sortHandBySuit(hand, trumpSuit);
  return sortHandStrongLeft(hand, trumpSuit);
}
