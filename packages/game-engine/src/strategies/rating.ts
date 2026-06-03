/**
 * Rating calculator interface. Phase 7 will plug a TrueSkill implementation
 * here; for now we ship an identity stub so Phase 5 integrations have a
 * stable seam.
 */

import type { PlayerId } from '../types.js';

export interface RatingInput {
  playerId: PlayerId;
  mu: number;
  sigma: number;
  /** 1 = winner, last = loser. */
  place: number;
}

export interface RatingOutput {
  playerId: PlayerId;
  mu: number;
  sigma: number;
}

export interface IRatingCalculator {
  apply(players: readonly RatingInput[]): RatingOutput[];
}

export class IdentityRatingCalculator implements IRatingCalculator {
  apply(players: readonly RatingInput[]): RatingOutput[] {
    return players.map((p) => ({ playerId: p.playerId, mu: p.mu, sigma: p.sigma }));
  }
}

export const identityRatingCalculator: IRatingCalculator = new IdentityRatingCalculator();
