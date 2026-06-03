/**
 * Fisher–Yates shuffle driven by our deterministic RNG. Returns a new array;
 * the input is not mutated. Two calls with identical seed + identical input
 * MUST produce identical output — this is what makes replay possible.
 */

import type { Rng } from '../rng.js';

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
