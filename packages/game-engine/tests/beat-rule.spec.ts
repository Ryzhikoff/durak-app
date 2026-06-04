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

  it('red joker beats red-suit standard cards regardless of trump', () => {
    expect(beats(joker('red'), card('hearts', 14), 'spades')).toBe(true);
    expect(beats(joker('red'), card('diamonds', 6), 'spades')).toBe(true);
    // Trump irrelevant for jokers.
    expect(beats(joker('red'), card('hearts', 6), 'clubs')).toBe(true);
    expect(beats(joker('red'), card('diamonds', 14), 'hearts')).toBe(true);
  });

  it('red joker does NOT beat black-suit standard cards', () => {
    expect(beats(joker('red'), card('spades', 6), 'spades')).toBe(false);
    expect(beats(joker('red'), card('clubs', 6), 'spades')).toBe(false);
    // Even the trump ace of a black suit.
    expect(beats(joker('red'), card('spades', 14), 'spades')).toBe(false);
    expect(beats(joker('red'), card('clubs', 14), 'clubs')).toBe(false);
  });

  it('black joker beats black-suit standard cards regardless of trump', () => {
    expect(beats(joker('black'), card('spades', 14), 'hearts')).toBe(true);
    expect(beats(joker('black'), card('clubs', 6), 'hearts')).toBe(true);
    expect(beats(joker('black'), card('spades', 6), 'diamonds')).toBe(true);
  });

  it('black joker does NOT beat red-suit standard cards', () => {
    expect(beats(joker('black'), card('hearts', 6), 'spades')).toBe(false);
    expect(beats(joker('black'), card('diamonds', 6), 'spades')).toBe(false);
    // Even the trump ace of a red suit.
    expect(beats(joker('black'), card('hearts', 14), 'hearts')).toBe(false);
    expect(beats(joker('black'), card('diamonds', 14), 'diamonds')).toBe(false);
  });

  it('joker does not beat another joker (either direction)', () => {
    expect(beats(joker('red'), joker('black'), 'spades')).toBe(false);
    expect(beats(joker('black'), joker('red'), 'spades')).toBe(false);
    expect(beats(joker('red'), joker('red'), 'spades')).toBe(false);
    expect(beats(joker('black'), joker('black'), 'spades')).toBe(false);
  });

  it('standard cards never beat a joker (not even the trump ace)', () => {
    expect(beats(card('spades', 14), joker('red'), 'spades')).toBe(false);
    expect(beats(card('spades', 14), joker('black'), 'spades')).toBe(false);
    expect(beats(card('hearts', 14), joker('red'), 'hearts')).toBe(false);
    expect(beats(card('hearts', 14), joker('black'), 'hearts')).toBe(false);
  });

  it('without trump suit (null) only same-suit higher beats', () => {
    expect(beats(card('hearts', 10), card('hearts', 9), null)).toBe(true);
    expect(beats(card('spades', 14), card('hearts', 9), null)).toBe(false);
  });
});
