import { describe, expect, it } from 'vitest';
import {
  canAttackWith,
  canBeatCard,
  canPlayerNoticeEntry,
  canTranslateWith,
} from './legality';
import type { AttackEntry, Card, ClientGameState, Rank } from './types';

const s = (
  id: string,
  suit: 'spades' | 'hearts' | 'diamonds' | 'clubs',
  rank: Rank,
): Card => ({ kind: 'standard', id, suit, rank });

const j = (id: string, color: 'red' | 'black'): Card => ({
  kind: 'joker',
  id,
  color,
});

const entry = (id: string, card: Card, beatenBy: Card | null = null): AttackEntry => ({
  id,
  card,
  beatenBy,
  attackerId: 'p1',
});

describe('canBeatCard', () => {
  it('same suit higher rank beats lower', () => {
    expect(canBeatCard(s('d', 'hearts', 10), s('a', 'hearts', 6), 'spades')).toBe(true);
    expect(canBeatCard(s('d', 'hearts', 5), s('a', 'hearts', 6), 'spades')).toBe(false);
  });

  it('different suit non-trump never beats', () => {
    expect(canBeatCard(s('d', 'clubs', 14), s('a', 'hearts', 6), 'spades')).toBe(false);
  });

  it('trump beats non-trump', () => {
    expect(canBeatCard(s('d', 'spades', 6), s('a', 'hearts', 14), 'spades')).toBe(true);
  });

  it('non-trump cannot beat trump', () => {
    expect(canBeatCard(s('d', 'hearts', 14), s('a', 'spades', 6), 'spades')).toBe(false);
  });

  it('red joker beats red-suit standard cards (trump irrelevant)', () => {
    expect(canBeatCard(j('jr', 'red'), s('a', 'hearts', 14), 'spades')).toBe(true);
    expect(canBeatCard(j('jr', 'red'), s('a', 'diamonds', 6), 'spades')).toBe(true);
    expect(canBeatCard(j('jr', 'red'), s('a', 'hearts', 6), 'clubs')).toBe(true);
  });

  it('red joker does NOT beat black-suit standard cards (even trump ace)', () => {
    expect(canBeatCard(j('jr', 'red'), s('a', 'spades', 6), 'spades')).toBe(false);
    expect(canBeatCard(j('jr', 'red'), s('a', 'clubs', 6), 'spades')).toBe(false);
    expect(canBeatCard(j('jr', 'red'), s('a', 'spades', 14), 'spades')).toBe(false);
    expect(canBeatCard(j('jr', 'red'), s('a', 'clubs', 14), 'clubs')).toBe(false);
  });

  it('black joker beats black-suit standard cards (trump irrelevant)', () => {
    expect(canBeatCard(j('jb', 'black'), s('a', 'spades', 14), 'hearts')).toBe(true);
    expect(canBeatCard(j('jb', 'black'), s('a', 'clubs', 6), 'hearts')).toBe(true);
    expect(canBeatCard(j('jb', 'black'), s('a', 'spades', 6), 'diamonds')).toBe(true);
  });

  it('black joker does NOT beat red-suit standard cards (even trump ace)', () => {
    expect(canBeatCard(j('jb', 'black'), s('a', 'hearts', 6), 'spades')).toBe(false);
    expect(canBeatCard(j('jb', 'black'), s('a', 'diamonds', 6), 'spades')).toBe(false);
    expect(canBeatCard(j('jb', 'black'), s('a', 'hearts', 14), 'hearts')).toBe(false);
    expect(canBeatCard(j('jb', 'black'), s('a', 'diamonds', 14), 'diamonds')).toBe(false);
  });

  it('joker does not beat another joker (either direction)', () => {
    expect(canBeatCard(j('jr', 'red'), j('jb', 'black'), 'spades')).toBe(false);
    expect(canBeatCard(j('jb', 'black'), j('jr', 'red'), 'spades')).toBe(false);
  });

  it('standard cards never beat a joker (not even trump ace)', () => {
    expect(canBeatCard(s('d', 'spades', 14), j('jr', 'red'), 'spades')).toBe(false);
    expect(canBeatCard(s('d', 'spades', 14), j('jb', 'black'), 'spades')).toBe(false);
    expect(canBeatCard(s('d', 'hearts', 14), j('jr', 'red'), 'hearts')).toBe(false);
    expect(canBeatCard(s('d', 'hearts', 14), j('jb', 'black'), 'hearts')).toBe(false);
  });
});

describe('canAttackWith', () => {
  it('any card is legal on an empty table', () => {
    expect(canAttackWith(s('a', 'hearts', 6), [])).toBe(true);
  });

  it('rank must match a rank already on the table', () => {
    const t = [entry('e1', s('a1', 'spades', 8))];
    expect(canAttackWith(s('a', 'hearts', 8), t)).toBe(true);
    expect(canAttackWith(s('a', 'hearts', 9), t)).toBe(false);
  });

  it('matches against defense card rank too', () => {
    const t = [entry('e1', s('a1', 'spades', 8), s('d1', 'spades', 9))];
    expect(canAttackWith(s('a', 'hearts', 9), t)).toBe(true);
  });
});

describe('canTranslateWith', () => {
  it('returns false on empty table', () => {
    expect(canTranslateWith(s('a', 'hearts', 8), [])).toBe(false);
  });

  it('all attacks must be unbeaten', () => {
    const t = [
      entry('e1', s('a1', 'spades', 8)),
      entry('e2', s('a2', 'hearts', 8), s('d1', 'hearts', 10)),
    ];
    expect(canTranslateWith(s('a', 'clubs', 8), t)).toBe(false);
  });

  it('all attacks must share the rank of the card being played', () => {
    const t = [
      entry('e1', s('a1', 'spades', 8)),
      entry('e2', s('a2', 'hearts', 8)),
    ];
    expect(canTranslateWith(s('a', 'clubs', 8), t)).toBe(true);
    expect(canTranslateWith(s('a', 'clubs', 9), t)).toBe(false);
  });

  it('jokers translate jokers', () => {
    const t = [entry('e1', j('jr', 'red'))];
    expect(canTranslateWith(j('jb', 'black'), t)).toBe(true);
    expect(canTranslateWith(s('a', 'clubs', 9), t)).toBe(false);
  });
});

describe('canPlayerNoticeEntry', () => {
  const baseSettings = {
    maxPlayers: 4 as const,
    firstBoutLimit: 6 as const,
    attackerScope: 'all' as const,
    cheatingEnabled: true,
    cheatAttempts: 3,
    cheatNoticeScope: 'all' as const,
    layoutOnRepeat: 'random' as const,
    firstTurn: 'lowest_trump' as const,
    deckSize: 36 as const,
    jokers: false,
    turnTimer: null,
  };
  const makeState = (
    overrides: Partial<ClientGameState> = {},
  ): ClientGameState => ({
    id: 'g1',
    settings: { ...baseSettings },
    myUserId: 'me',
    status: 'bout_defense',
    trumpCard: null,
    trumpSuit: 'spades',
    deckSize: 0,
    discardSize: 0,
    table: { attacks: [] },
    boutNumber: 1,
    loserPlayerId: null,
    currentAttackerId: 'atk',
    currentDefenderId: 'def',
    passedPlayerIds: [],
    players: [],
    ...overrides,
  });
  const atkEntry = (attackerId: string, beaten = false): AttackEntry => ({
    id: 'e1',
    card: s('a', 'spades', 8),
    beatenBy: beaten ? s('b', 'spades', 9) : null,
    attackerId,
  });

  it('returns false when cheating is disabled', () => {
    const st = makeState({
      settings: { ...baseSettings, cheatingEnabled: false },
    });
    expect(canPlayerNoticeEntry(st, atkEntry('atk'), 'def')).toBe(false);
  });

  it('beat-cheat: defender cannot notice their own beat', () => {
    const st = makeState();
    expect(canPlayerNoticeEntry(st, atkEntry('atk', true), 'def')).toBe(false);
  });

  it('beat-cheat: anyone else (incl. attacker) can notice', () => {
    const st = makeState();
    expect(canPlayerNoticeEntry(st, atkEntry('atk', true), 'atk')).toBe(true);
    expect(canPlayerNoticeEntry(st, atkEntry('atk', true), 'other')).toBe(true);
  });

  it('attack-cheat: cheater (attacker who placed it) cannot notice', () => {
    const st = makeState();
    expect(canPlayerNoticeEntry(st, atkEntry('atk'), 'atk')).toBe(false);
  });

  it('attack-cheat with scope=defender_only: only defender notices', () => {
    const st = makeState({
      settings: { ...baseSettings, cheatNoticeScope: 'defender_only' },
    });
    expect(canPlayerNoticeEntry(st, atkEntry('atk'), 'def')).toBe(true);
    expect(canPlayerNoticeEntry(st, atkEntry('atk'), 'other')).toBe(false);
  });

  it('attack-cheat with scope=all: every non-cheater notices', () => {
    const st = makeState({
      settings: { ...baseSettings, cheatNoticeScope: 'all' },
    });
    expect(canPlayerNoticeEntry(st, atkEntry('atk'), 'def')).toBe(true);
    expect(canPlayerNoticeEntry(st, atkEntry('atk'), 'other')).toBe(true);
    expect(canPlayerNoticeEntry(st, atkEntry('atk'), 'atk')).toBe(false);
  });
});

describe('cheating-off client gating', () => {
  it('blocks an illegal beat (would be allowed when cheating is on)', () => {
    // Attempt to beat ♠A with ♥7 — illegal.
    const attack = s('a1', 'spades', 14);
    const defense = s('d1', 'hearts', 7);
    expect(canBeatCard(defense, attack, 'clubs')).toBe(false);
  });

  it('allows a legal beat', () => {
    const attack = s('a1', 'hearts', 7);
    const defense = s('d1', 'hearts', 10);
    expect(canBeatCard(defense, attack, 'spades')).toBe(true);
  });
});
