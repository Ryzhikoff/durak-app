/**
 * First-bout limit strategy. Implements `LobbySettings.firstBoutLimit`:
 *
 *  - `5`             — at most 5 attack cards in bout #1.
 *  - `6`             — at most 6 attack cards in bout #1.
 *  - `'defender_hand'` — limit = ORIGINAL defender's hand size at the start
 *                        of bout #1. Even after a translate, the cap stays
 *                        tied to the initial defender's hand.
 *
 * From bout #2 onwards the limit is the standard `min(6, currentDefender.hand
 * size at the START of the bout)`.
 */

import type { LobbySettings } from '@durak/shared-types';
import type { GameState } from '../types.js';

export interface IFirstBoutLimit {
  /**
   * Returns the cap on total attacks for the current bout, including
   * translations. Reducers ALSO clamp by the current defender's hand size
   * (you can't make a defender beat more cards than they can hold) — that
   * clamp lives in `transitions.ts`, not here.
   */
  limit(state: GameState): number;
}

export class DefaultFirstBoutLimit implements IFirstBoutLimit {
  limit(state: GameState): number {
    if (state.boutNumber === 1) {
      const setting: LobbySettings['firstBoutLimit'] = state.settings.firstBoutLimit;
      if (setting === 5) return 5;
      if (setting === 6) return 6;
      // defender_hand: tied to initial defender's hand size at start of bout 1.
      return state.initialDefenderHandSize;
    }
    return 6;
  }
}

export const defaultFirstBoutLimit: IFirstBoutLimit = new DefaultFirstBoutLimit();
