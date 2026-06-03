import { describe, expect, it } from 'vitest';
import { DefaultDeckFactory } from '../src/deck/factory.js';
import { isJoker, isStandard } from '../src/deck/card.js';

const factory = new DefaultDeckFactory();

describe('DefaultDeckFactory', () => {
  it('builds 36 distinct cards for 36-card deck without jokers', () => {
    const deck = factory.build({ deckSize: 36, jokers: false });
    expect(deck).toHaveLength(36);
    const ids = new Set(deck.map((c) => c.id));
    expect(ids.size).toBe(36);
    expect(deck.every(isStandard)).toBe(true);
  });

  it('builds 52 distinct cards for 52-card deck without jokers', () => {
    const deck = factory.build({ deckSize: 52, jokers: false });
    expect(deck).toHaveLength(52);
    const ids = new Set(deck.map((c) => c.id));
    expect(ids.size).toBe(52);
  });

  it('adds 2 jokers when enabled (36)', () => {
    const deck = factory.build({ deckSize: 36, jokers: true });
    expect(deck).toHaveLength(38);
    const jokers = deck.filter(isJoker);
    expect(jokers).toHaveLength(2);
    expect(new Set(jokers.map((j) => j.color))).toEqual(new Set(['red', 'black']));
  });

  it('adds 2 jokers when enabled (52)', () => {
    const deck = factory.build({ deckSize: 52, jokers: true });
    expect(deck).toHaveLength(54);
  });

  it('36-card deck has ranks 6..14 only', () => {
    const deck = factory.build({ deckSize: 36, jokers: false });
    const ranks = new Set(deck.filter(isStandard).map((c) => c.rank));
    expect([...ranks].sort((a, b) => a - b)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it('52-card deck has ranks 2..14', () => {
    const deck = factory.build({ deckSize: 52, jokers: false });
    const ranks = new Set(deck.filter(isStandard).map((c) => c.rank));
    expect([...ranks].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it('each card appears exactly once per suit/rank', () => {
    const deck = factory.build({ deckSize: 36, jokers: false });
    const grouped = new Map<string, number>();
    for (const c of deck) {
      grouped.set(c.id, (grouped.get(c.id) ?? 0) + 1);
    }
    for (const count of grouped.values()) {
      expect(count).toBe(1);
    }
  });
});
