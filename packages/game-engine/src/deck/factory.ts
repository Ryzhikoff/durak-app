/**
 * Deck factories. The default factory builds a 36- or 52-card deck plus
 * optional jokers per the supplied `LobbySettings`. Cards are returned in a
 * stable canonical order; shuffling is a separate step (`shuffle.ts`).
 *
 * The interface is exposed so tests / Phase 5 can plug a stub factory
 * (e.g. for golden-path scenarios).
 */

import type { LobbySettings } from '@durak/shared-types';
import type { Card, JokerColor, Rank, Suit } from '../types.js';
import { RANKS_36, RANKS_52, SUITS_36, makeJokerId, makeStandardId } from './card.js';

export interface IDeckFactory {
  build(settings: Pick<LobbySettings, 'deckSize' | 'jokers'>): Card[];
}

export class DefaultDeckFactory implements IDeckFactory {
  build(settings: Pick<LobbySettings, 'deckSize' | 'jokers'>): Card[] {
    const ranks: readonly Rank[] = settings.deckSize === 52 ? RANKS_52 : RANKS_36;
    const cards: Card[] = [];
    for (const suit of SUITS_36) {
      for (const rank of ranks) {
        cards.push(buildStandard(suit, rank));
      }
    }
    if (settings.jokers) {
      cards.push(buildJoker('red'));
      cards.push(buildJoker('black'));
    }
    return cards;
  }
}

function buildStandard(suit: Suit, rank: Rank): Card {
  return { kind: 'standard', id: makeStandardId(suit, rank), suit, rank };
}

function buildJoker(color: JokerColor): Card {
  return { kind: 'joker', id: makeJokerId(color), color };
}

export const defaultDeckFactory: IDeckFactory = new DefaultDeckFactory();
