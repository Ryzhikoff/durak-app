/**
 * Deterministic RNG used everywhere in the engine so that any game can be
 * replayed bit-for-bit from a seed. We use mulberry32 — small, fast, decent
 * statistical quality for our purposes (deck shuffles, tie-breaking).
 *
 * Usage:
 *   const rng = createRng(seed);
 *   const value = rng.nextFloat(); // [0, 1)
 *   const i = rng.nextInt(0, 36);  // [0, 36)
 */

export interface Rng {
  /** Returns a float in [0, 1). Deterministic given the seed. */
  nextFloat(): number;
  /** Returns an integer in [minInclusive, maxExclusive). */
  nextInt(minInclusive: number, maxExclusive: number): number;
  /** Current internal state (useful for snapshotting / resuming). */
  getState(): number;
}

export function createRng(seed: number): Rng {
  // Normalise the seed to a 32-bit unsigned int.
  let state = seed >>> 0 || 1;

  function nextFloat(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function nextInt(minInclusive: number, maxExclusive: number): number {
    if (maxExclusive <= minInclusive) {
      throw new Error('nextInt: maxExclusive must be > minInclusive');
    }
    const span = maxExclusive - minInclusive;
    return minInclusive + Math.floor(nextFloat() * span);
  }

  function getState(): number {
    return state;
  }

  return { nextFloat, nextInt, getState };
}
