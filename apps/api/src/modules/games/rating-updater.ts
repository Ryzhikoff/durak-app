/**
 * Phase 7A — TrueSkill rating updates via openskill (PlackettLuce).
 *
 * Wraps openskill's `rate()` into a stable shape: one row per player with
 * before/after mu+sigma and a displayDelta. Pure: takes ratings + ranks,
 * returns new ratings.
 *
 * Tie semantics: players who exit in the same bout share a rank; the durak
 * always gets `playerCount`. On a draw (loserId === null) everyone shares the
 * top rank — openskill treats that as a draw and updates only via σ-shrink.
 */

import { rate, type Options, type Rating } from 'openskill';

export interface RatingPlayer {
  userId: string;
  muBefore: number;
  sigmaBefore: number;
  /**
   * Final placement, 1 = best (got out first), N = durak. Ties allowed —
   * openskill's `rank` array is treated as ordinal (equal ranks → draw).
   */
  place: number;
}

export interface RatingOutcome {
  userId: string;
  muBefore: number;
  sigmaBefore: number;
  muAfter: number;
  sigmaAfter: number;
  /** (muAfter - 3σAfter) - (muBefore - 3σBefore), display-friendly. */
  deltaDisplay: number;
}

export interface RatingOptions {
  beta: number;
  tau: number;
  drawProbability: number;
}

/** Conservative TrueSkill display number, matches rating.service. */
export function conservativeRating(mu: number, sigma: number): number {
  return Math.round(mu - 3 * sigma);
}

/**
 * Compute new (mu, sigma) per player. Returns rows in the same order as
 * the input array. Throws on empty input.
 */
export function updateRatings(players: RatingPlayer[], opts: RatingOptions): RatingOutcome[] {
  if (players.length === 0) {
    throw new Error('updateRatings: empty players');
  }
  // Each player is a singleton team — openskill requires Team = Rating[].
  const teams: Rating[][] = players.map((p) => [{ mu: p.muBefore, sigma: p.sigmaBefore }]);
  const ranks = players.map((p) => p.place);
  const options: Options = {
    beta: opts.beta,
    tau: opts.tau,
    rank: ranks,
    // openskill bakes drawProbability into the PlackettLuce model only when
    // the `model` is set. For 1-vs-1 it isn't used; we keep PL via default.
    // openskill 4.x doesn't expose drawProbability directly — ties in `rank`
    // are what trigger draw handling. We still surface it on the config so
    // a future model switch can plug it in without schema churn.
  };
  const rated = rate(teams, options);
  return players.map((p, idx) => {
    const team = rated[idx];
    const out = team[0];
    const before = conservativeRating(p.muBefore, p.sigmaBefore);
    const after = conservativeRating(out.mu, out.sigma);
    return {
      userId: p.userId,
      muBefore: p.muBefore,
      sigmaBefore: p.sigmaBefore,
      muAfter: out.mu,
      sigmaAfter: out.sigma,
      deltaDisplay: after - before,
    };
  });
}
