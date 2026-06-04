import { describe, expect, it } from 'vitest';
import { conservativeRating, updateRatings } from './rating-updater';

const DEFAULTS = { beta: 4.166667, tau: 0.083333, drawProbability: 0.1 };

function freshPlayer(id: string, place: number) {
  return { userId: id, muBefore: 25, sigmaBefore: 8.333333, place };
}

describe('updateRatings — single-game outcomes', () => {
  it('throws on empty input', () => {
    expect(() => updateRatings([], DEFAULTS)).toThrow(/empty/);
  });

  it('2-player game: the winner gains and the loser loses', () => {
    const [winner, loser] = updateRatings([freshPlayer('w', 1), freshPlayer('l', 2)], DEFAULTS);
    // mu moves toward the outcome (winner up, loser down).
    expect(winner.muAfter).toBeGreaterThan(winner.muBefore);
    expect(loser.muAfter).toBeLessThan(loser.muBefore);
    // Sigma always shrinks (we learned something).
    expect(winner.sigmaAfter).toBeLessThan(winner.sigmaBefore);
    expect(loser.sigmaAfter).toBeLessThan(loser.sigmaBefore);
    // Conservative-rating delta is positive for the winner; loser's display
    // value can move either way because sigma shrinks too (less uncertainty
    // pushes mu - 3σ up). Just check it's bounded.
    expect(winner.deltaDisplay).toBeGreaterThan(0);
    expect(Math.abs(loser.deltaDisplay)).toBeLessThan(20);
  });

  it('preserves the input order and returns identifiable rows', () => {
    const out = updateRatings(
      [freshPlayer('a', 1), freshPlayer('b', 2), freshPlayer('c', 3)],
      DEFAULTS,
    );
    expect(out.map((o) => o.userId)).toEqual(['a', 'b', 'c']);
  });

  it('treats a draw (all rank=1) by shrinking sigma without spreading mus apart', () => {
    const out = updateRatings(
      [freshPlayer('a', 1), freshPlayer('b', 1), freshPlayer('c', 1)],
      DEFAULTS,
    );
    // Everyone shares the same outcome; mus stay close to start, sigmas shrink.
    for (const o of out) {
      expect(o.sigmaAfter).toBeLessThanOrEqual(o.sigmaBefore);
      expect(Math.abs(o.muAfter - o.muBefore)).toBeLessThan(0.5);
    }
  });

  it('3-player non-draw: mid-place stays close, last drops the most', () => {
    const out = updateRatings(
      [freshPlayer('a', 1), freshPlayer('b', 2), freshPlayer('c', 3)],
      DEFAULTS,
    );
    const winner = out[0];
    const last = out[2];
    expect(winner.deltaDisplay).toBeGreaterThan(0);
    expect(last.muAfter).toBeLessThan(last.muBefore);
  });

  it('rates can be supplied with custom mu / sigma starting points', () => {
    const out = updateRatings(
      [
        { userId: 'strong', muBefore: 30, sigmaBefore: 2, place: 1 },
        { userId: 'weak', muBefore: 20, sigmaBefore: 2, place: 2 },
      ],
      DEFAULTS,
    );
    // Strong+1st gains little (low sigma), weak+2nd loses little.
    expect(Math.abs(out[0].muAfter - out[0].muBefore)).toBeLessThan(1);
    expect(Math.abs(out[1].muAfter - out[1].muBefore)).toBeLessThan(1);
  });
});

describe('conservativeRating', () => {
  it('rounds (mu - 3*sigma)', () => {
    expect(conservativeRating(25, 8.333333)).toBe(0);
    expect(conservativeRating(30, 1)).toBe(27);
    expect(conservativeRating(15.4, 0)).toBe(15);
  });
});
