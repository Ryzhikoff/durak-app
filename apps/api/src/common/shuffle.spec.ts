import { describe, expect, it } from 'vitest';
import { fisherYatesShuffle } from './shuffle';

describe('fisherYatesShuffle', () => {
  it('returns a new array (never mutates the input)', () => {
    const input = [1, 2, 3, 4, 5];
    const snapshot = [...input];
    const out = fisherYatesShuffle(input);
    expect(out).not.toBe(input);
    expect(input).toEqual(snapshot);
  });

  it('preserves the multiset of elements', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f'];
    const out = fisherYatesShuffle(input);
    expect(out).toHaveLength(input.length);
    expect([...out].sort()).toEqual([...input].sort());
  });

  it('returns a fresh array for empty / single inputs', () => {
    const empty: number[] = [];
    const single = [42];
    const e = fisherYatesShuffle(empty);
    const s = fisherYatesShuffle(single);
    expect(e).not.toBe(empty);
    expect(e).toEqual([]);
    expect(s).not.toBe(single);
    expect(s).toEqual([42]);
  });

  it('actually permutes — produces a non-identity ordering with overwhelming probability', () => {
    // With 8 elements the chance the shuffle yields the identity permutation is
    // 1/40320. We sample 32 shuffles; the chance all 32 are identity is
    // (1/40320)^32 ≈ 0 — effectively zero flakiness.
    const input = [0, 1, 2, 3, 4, 5, 6, 7];
    let anyDifferent = false;
    for (let i = 0; i < 32; i++) {
      const out = fisherYatesShuffle(input);
      if (out.some((v, idx) => v !== input[idx])) {
        anyDifferent = true;
        break;
      }
    }
    expect(anyDifferent).toBe(true);
  });
});
