/**
 * Deal strategy: removes `handSize` cards per player from the top of the
 * deck (= end of array). Returns each player's hand and the trimmed deck.
 * The "top of deck = end of array" convention is shared by every reducer
 * that draws cards.
 */

import type { Card, PlayerSeat } from '../types.js';

export interface DealResult {
  hands: Record<string, Card[]>;
  /** Remaining deck (top of deck stays at the end of the array). */
  deck: Card[];
}

export interface IDealStrategy {
  deal(deck: readonly Card[], players: readonly PlayerSeat[], handSize: number): DealResult;
}

export class StandardDealStrategy implements IDealStrategy {
  deal(deck: readonly Card[], players: readonly PlayerSeat[], handSize: number): DealResult {
    const remaining = deck.slice();
    const hands: Record<string, Card[]> = {};

    for (const player of players) {
      hands[player.id] = [];
    }
    for (let i = 0; i < handSize; i++) {
      for (const player of players) {
        const card = remaining.pop();
        if (!card) {
          return { hands, deck: remaining };
        }
        hands[player.id].push(card);
      }
    }
    return { hands, deck: remaining };
  }
}

export const standardDealStrategy: IDealStrategy = new StandardDealStrategy();

export const STANDARD_HAND_SIZE = 6;
