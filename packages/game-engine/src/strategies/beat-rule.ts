/**
 * Beat rule strategy: encapsulates "does card X beat card Y?". The default
 * implementation is the canonical Durak rule, with jokers beating everything
 * non-joker (see `deck/card.beats`).
 */

import type { Card, Suit } from '../types.js';
import { beats as defaultBeats } from '../deck/card.js';

export interface IBeatRule {
  beats(defender: Card, attacker: Card, trumpSuit: Suit | null): boolean;
}

export class DefaultBeatRule implements IBeatRule {
  beats(defender: Card, attacker: Card, trumpSuit: Suit | null): boolean {
    return defaultBeats(defender, attacker, trumpSuit);
  }
}

export const defaultBeatRule: IBeatRule = new DefaultBeatRule();
