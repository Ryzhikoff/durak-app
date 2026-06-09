/**
 * First-bout limit strategy. Implements `LobbySettings.firstBoutLimit`:
 *
 *  - `5`             — at most 5 attack cards per bout while the limit holds.
 *  - `6`             — at most 6 attack cards per bout while the limit holds.
 *  - `'defender_hand'` — limit = the current defender's hand size at the
 *                        start of the bout (captured in
 *                        `state.initialDefenderHandSize`).
 *
 * The limit applies until the first bout in the game closes with
 * `outcome: 'beaten'`. Bouts that close via `take` keep the limit in force —
 * the rule is "first SUCCESSFUL DEFENSE", not "first bout". Once
 * `state.firstDefenseHappened` flips to `true` the strategy switches to the
 * standard `min(6, defender_hand)` cap (i.e. returns `6` here; reducers /
 * transitions apply the additional hand-size clamp).
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
    // Latch held: standard durak cap. The hand-size clamp in
    // `attacksRemaining` then narrows this to min(6, initialDefenderHandSize).
    if (state.firstDefenseHappened) {
      return 6;
    }
    const setting: LobbySettings['firstBoutLimit'] = state.settings.firstBoutLimit;
    if (setting === 5) return 5;
    if (setting === 6) return 6;
    // `defender_hand` — tied to the current defender's hand size at the
    // start of the current bout. This matches the original intent for bout
    // #1 and naturally generalises while the latch is still pending: each
    // intermediate bout (closed by take or translate) uses its own defender's
    // starting hand. `initialDefenderHandSize` is refreshed by translate and
    // by `startNewBout`.
    return state.initialDefenderHandSize;
  }
}

export const defaultFirstBoutLimit: IFirstBoutLimit = new DefaultFirstBoutLimit();
