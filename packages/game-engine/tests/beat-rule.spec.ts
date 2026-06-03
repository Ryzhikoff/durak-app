import { describe, expect, it } from 'vitest';
import { beats } from '../src/deck/card.js';
import { card, joker } from '../src/_testing/fixtures.js';

describe('beats', () => {
  it('same suit higher rank beats lower rank', () => {
    expect(beats(card('hearts', 10), card('hearts', 9), 'spades')).toBe(true);
    expect(beats(card('hearts', 9), card('hearts', 10), 'spades')).toBe(false);
  });

  it('same suit equal rank does NOT beat', () => {
    expect(beats(card('hearts', 10), card('hearts', 10), 'spades')).toBe(false);
  });

  it('different suit non-trump does not beat', () => {
    expect(beats(card('hearts', 14), card('clubs', 6), 'spades')).toBe(false);
  });

  it('trump beats non-trump', () => {
    expect(beats(card('spades', 6), card('hearts', 14), 'spades')).toBe(true);
    expect(beats(card('spades', 6), card('hearts', 6), 'spades')).toBe(true);
  });

  it('higher trump beats lower trump', () => {
    expect(beats(card('spades', 10), card('spades', 9), 'spades')).toBe(true);
    expect(beats(card('spades', 9), card('spades', 10), 'spades')).toBe(false);
  });

  it('non-trump never beats trump', () => {
    expect(beats(card('hearts', 14), card('spades', 6), 'spades')).toBe(false);
  });

  it('joker beats any standard card', () => {
    expect(beats(joker('red'), card('spades', 14), 'spades')).toBe(true);
    expect(beats(joker('black'), card('hearts', 6), 'spades')).toBe(true);
  });

  it('joker does not beat another joker', () => {
    expect(beats(joker('red'), joker('black'), 'spades')).toBe(false);
    expect(beats(joker('black'), joker('red'), 'spades')).toBe(false);
  });

  it('standard card does not beat a joker', () => {
    expect(beats(card('spades', 14), joker('red'), 'spades')).toBe(false);
  });

  it('without trump suit (null) only same-suit higher beats', () => {
    expect(beats(card('hearts', 10), card('hearts', 9), null)).toBe(true);
    expect(beats(card('spades', 14), card('hearts', 9), null)).toBe(false);
  });
});
