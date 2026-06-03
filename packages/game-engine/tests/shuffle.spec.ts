import { describe, expect, it } from 'vitest';
import { shuffle } from '../src/deck/shuffle.js';
import { createRng } from '../src/rng.js';
import { DefaultDeckFactory } from '../src/deck/factory.js';

const factory = new DefaultDeckFactory();

describe('shuffle', () => {
  it('is deterministic for the same seed', () => {
    const deck = factory.build({ deckSize: 36, jokers: false });
    const a = shuffle(deck, createRng(42));
    const b = shuffle(deck, createRng(42));
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });

  it('produces different orders for different seeds', () => {
    const deck = factory.build({ deckSize: 36, jokers: false });
    const a = shuffle(deck, createRng(1));
    const b = shuffle(deck, createRng(2));
    expect(a.map((c) => c.id)).not.toEqual(b.map((c) => c.id));
  });

  it('does not mutate input', () => {
    const deck = factory.build({ deckSize: 36, jokers: false });
    const snapshot = deck.map((c) => c.id);
    shuffle(deck, createRng(7));
    expect(deck.map((c) => c.id)).toEqual(snapshot);
  });

  it('preserves the multiset of cards', () => {
    const deck = factory.build({ deckSize: 36, jokers: false });
    const shuffled = shuffle(deck, createRng(99));
    expect(shuffled).toHaveLength(deck.length);
    expect(new Set(shuffled.map((c) => c.id))).toEqual(new Set(deck.map((c) => c.id)));
  });
});

describe('createRng', () => {
  it('produces floats in [0, 1)', () => {
    const rng = createRng(123);
    for (let i = 0; i < 100; i++) {
      const v = rng.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt range is correct', () => {
    const rng = createRng(555);
    for (let i = 0; i < 200; i++) {
      const v = rng.nextInt(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(10);
    }
  });

  it('same seed = same stream', () => {
    const a = createRng(7);
    const b = createRng(7);
    for (let i = 0; i < 20; i++) {
      expect(a.nextFloat()).toEqual(b.nextFloat());
    }
  });
});
