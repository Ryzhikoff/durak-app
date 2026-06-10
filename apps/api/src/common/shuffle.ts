import { randomInt } from 'node:crypto';

/**
 * Signature of a Fisher–Yates shuffle. Returns a NEW array — never mutates the
 * input. Implementations are expected to draw from a CSPRNG; the default
 * {@link fisherYatesShuffle} uses `crypto.randomInt`.
 *
 * Exported as a function-type so consumers (e.g. RematchService) can accept it
 * as an injected dependency. Tests substitute an identity (or a deterministic
 * reverse) implementation to remove the RNG from assertions.
 */
export type ShuffleFn = <T>(items: readonly T[]) => T[];

/**
 * Cryptographically-strong Fisher–Yates shuffle.
 *
 * Uses `crypto.randomInt(0, i + 1)` for each swap so we don't inherit
 * `Math.random`'s deterministic-per-process bias, nor the classic
 * `sort(() => Math.random() - 0.5)` non-uniform distribution.
 *
 * Returns a fresh array; the input is never mutated. Empty / single-element
 * arrays are returned unchanged (allocating a new array each time so callers
 * never accidentally share references).
 */
export const fisherYatesShuffle: ShuffleFn = <T>(items: readonly T[]): T[] => {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    // randomInt's upper bound is exclusive, so [0, i+1) === [0, i].
    const j = randomInt(0, i + 1);
    if (j !== i) {
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
  }
  return out;
};
