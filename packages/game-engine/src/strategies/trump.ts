/**
 * Trump selector: given the shuffled deck (top = end of array, bottom = index
 * 0), return both the visible trump card and the trump suit. With jokers in
 * play the trump card MUST be a non-joker — we scan upward from the bottom
 * until we find one. If somehow none exist (pathological), trumpSuit falls
 * back to 'clubs' but trumpCard is null.
 */

import type { Card, Suit } from '../types.js';
import { isJoker } from '../deck/card.js';

export interface TrumpSelection {
  trumpCard: Card | null;
  trumpSuit: Suit | null;
}

export interface ITrumpSelector {
  select(shuffledDeck: readonly Card[]): TrumpSelection;
}

export class DefaultTrumpSelector implements ITrumpSelector {
  select(shuffledDeck: readonly Card[]): TrumpSelection {
    for (let i = 0; i < shuffledDeck.length; i++) {
      const card = shuffledDeck[i];
      if (!isJoker(card)) {
        return { trumpCard: card, trumpSuit: card.suit };
      }
    }
    // No standard card found — only happens in tests with synthetic decks.
    return { trumpCard: null, trumpSuit: 'clubs' };
  }
}

export const defaultTrumpSelector: ITrumpSelector = new DefaultTrumpSelector();
