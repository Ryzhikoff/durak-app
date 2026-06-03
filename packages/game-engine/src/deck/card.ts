/**
 * Card helpers: id generation, equality, ordering, and the canonical beats
 * relation. Lives next to deck factories because everything here is purely
 * about cards — no game state is consulted.
 */

import type { Card, Rank, StandardCard, Suit } from '../types.js';

export const SUITS_36: readonly Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'] as const;

export const RANKS_36: readonly Rank[] = [6, 7, 8, 9, 10, 11, 12, 13, 14] as const;
export const RANKS_52: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;

export function isJoker(card: Card): card is { kind: 'joker'; id: string; color: 'red' | 'black' } {
  return card.kind === 'joker';
}

export function isStandard(card: Card): card is StandardCard {
  return card.kind === 'standard';
}

export function makeStandardId(suit: Suit, rank: Rank): string {
  return `${suit}-${rank}`;
}

export function makeJokerId(color: 'red' | 'black'): string {
  return `joker-${color}`;
}

/**
 * Standard "beats" relation:
 * - jokers beat everything except other jokers
 * - same suit + higher rank → beats
 * - trump beats non-trump
 * - higher trump beats lower trump
 *
 * Does NOT consult game state; trump suit is passed explicitly.
 */
export function beats(defender: Card, attacker: Card, trumpSuit: Suit | null): boolean {
  if (isJoker(defender)) {
    return !isJoker(attacker);
  }
  if (isJoker(attacker)) {
    return false;
  }
  const defenderIsTrump = trumpSuit !== null && defender.suit === trumpSuit;
  const attackerIsTrump = trumpSuit !== null && attacker.suit === trumpSuit;

  if (defender.suit === attacker.suit) {
    return defender.rank > attacker.rank;
  }
  if (defenderIsTrump && !attackerIsTrump) {
    return true;
  }
  return false;
}

/**
 * Strict ordering used to find the lowest trump for the "lowest_trump" first
 * player rule. Jokers are treated as the highest possible card and therefore
 * never qualify as "lowest".
 */
export function cardSortValue(card: Card, trumpSuit: Suit | null): number {
  if (isJoker(card)) {
    return Number.MAX_SAFE_INTEGER;
  }
  const trumpBoost = trumpSuit !== null && card.suit === trumpSuit ? 100 : 0;
  return trumpBoost + card.rank;
}
