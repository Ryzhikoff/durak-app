import { describe, expect, it } from 'vitest';
import { createGame, type GameState, type PlayerSeat } from '@durak/game-engine';
import { DEFAULT_LOBBY_SETTINGS } from '@durak/shared-types';
import { redactForPlayer, type GameUserProfiles } from './game-redactor';

const seats: PlayerSeat[] = [
  { id: 'ua', nickname: 'Alice' },
  { id: 'ub', nickname: 'Bob' },
  { id: 'uc', nickname: 'Carol' },
];

function makeState(): GameState {
  return createGame({
    id: 'g1',
    seed: 12345,
    settings: { ...DEFAULT_LOBBY_SETTINGS, maxPlayers: 3 },
    players: seats,
    previousLoserId: null,
  });
}

function makeProfiles(): GameUserProfiles {
  return {
    ua: {
      nickname: 'Alice',
      avatarUrl: '/u/a.png',
      cardBackId: 'pattern-3',
      customCardBackUrl: null,
    },
    ub: {
      nickname: 'Bob',
      avatarUrl: null,
      cardBackId: 'pattern-1',
      customCardBackUrl: '/u/bob.png',
    },
    uc: {
      nickname: 'Carol',
      avatarUrl: '/u/c.png',
      cardBackId: 'classic-1',
      customCardBackUrl: null,
    },
  };
}

describe('redactForPlayer', () => {
  it('exposes the viewer hand and hides everyone else', () => {
    const state = makeState();
    const profiles = makeProfiles();
    const snapshot = redactForPlayer(state, 'ua', profiles);

    expect(snapshot.myUserId).toBe('ua');
    // Public bits.
    expect(snapshot.id).toBe('g1');
    expect(snapshot.settings.maxPlayers).toBe(3);
    expect(snapshot.trumpCard).toBeTruthy();
    expect(snapshot.trumpSuit).toBeTruthy();
    expect(snapshot.deckSize).toBe(state.deck.length);
    expect(snapshot.discardSize).toBe(0);
    expect(snapshot.boutNumber).toBe(1);

    // Viewer's hand fully present.
    const me = snapshot.players.find((p) => p.id === 'ua')!;
    expect(me.hand).toBeDefined();
    expect(me.hand?.length).toBe(state.players[0].hand.length);

    // Opponents have no `hand`, but expose handSize.
    for (const id of ['ub', 'uc']) {
      const opp = snapshot.players.find((p) => p.id === id)!;
      expect(opp.hand).toBeUndefined();
      expect(opp.handSize).toBe(state.players.find((p) => p.id === id)!.hand.length);
    }
  });

  it('reveals no card data outside the viewer slot', () => {
    const state = makeState();
    const snapshot = redactForPlayer(state, 'ub', makeProfiles());
    const serialised = JSON.stringify(snapshot);
    // Each opponent card id should not appear anywhere in Bob's snapshot.
    for (const card of state.players[0].hand) {
      expect(serialised).not.toContain(card.id);
    }
    for (const card of state.players[2].hand) {
      expect(serialised).not.toContain(card.id);
    }
    // Bob's own cards SHOULD be there.
    for (const card of state.players[1].hand) {
      expect(serialised).toContain(card.id);
    }
  });

  it('overlays profile fields (avatar, cardBackId) on each player slot', () => {
    const state = makeState();
    const snapshot = redactForPlayer(state, 'ua', makeProfiles());
    const a = snapshot.players.find((p) => p.id === 'ua')!;
    expect(a.avatarUrl).toBe('/u/a.png');
    expect(a.cardBackId).toBe('pattern-3');
    expect(a.customCardBackUrl).toBeNull();
    const b = snapshot.players.find((p) => p.id === 'ub')!;
    expect(b.customCardBackUrl).toBe('/u/bob.png');
  });

  it('falls back to engine nickname when profile is missing', () => {
    const state = makeState();
    const snapshot = redactForPlayer(state, 'ua', {});
    const a = snapshot.players.find((p) => p.id === 'ua')!;
    expect(a.nickname).toBe('Alice');
    expect(a.avatarUrl).toBeNull();
    expect(a.cardBackId).toBe('classic-1');
  });

  it('does not reveal a hand when the viewer is not seated', () => {
    const state = makeState();
    const snapshot = redactForPlayer(state, 'outsider', makeProfiles());
    expect(snapshot.players.every((p) => p.hand === undefined)).toBe(true);
  });

  it('returns finishPlace for finished players and isFinished flag', () => {
    const state = makeState();
    const next: GameState = { ...state, finishedPlayers: ['uc', 'ua'] };
    const snapshot = redactForPlayer(next, 'ub', makeProfiles());
    const c = snapshot.players.find((p) => p.id === 'uc')!;
    const a = snapshot.players.find((p) => p.id === 'ua')!;
    const b = snapshot.players.find((p) => p.id === 'ub')!;
    expect(c.isFinished).toBe(true);
    expect(c.finishPlace).toBe(1);
    expect(a.isFinished).toBe(true);
    expect(a.finishPlace).toBe(2);
    expect(b.isFinished).toBe(false);
    expect(b.finishPlace).toBeUndefined();
  });

  it('reflects passed players in isPassed', () => {
    const state = makeState();
    const next: GameState = { ...state, passedPlayerIds: ['ua'] };
    const snapshot = redactForPlayer(next, 'ub', {});
    expect(snapshot.players.find((p) => p.id === 'ua')?.isPassed).toBe(true);
    expect(snapshot.players.find((p) => p.id === 'ub')?.isPassed).toBe(false);
    expect(snapshot.passedPlayerIds).toEqual(['ua']);
  });

  it('does not leak engine-private fields (randSeed / rngState / deck / discard)', () => {
    const state = makeState();
    const snapshot = redactForPlayer(state, 'ua', makeProfiles());
    const serialised = JSON.stringify(snapshot);
    expect(serialised).not.toMatch(/"randSeed"/);
    expect(serialised).not.toMatch(/"rngState"/);
    expect(serialised).not.toMatch(/"deck":\[/);
    expect(serialised).not.toMatch(/"discard":\[/);
    expect(serialised).not.toMatch(/"nextEntryId"/);
    expect(serialised).not.toMatch(/"initialDefenderHandSize"/);
  });

  it('makes a defensive copy of the viewer hand', () => {
    const state = makeState();
    const snapshot = redactForPlayer(state, 'ua', makeProfiles());
    const me = snapshot.players.find((p) => p.id === 'ua')!;
    expect(me.hand).not.toBe(state.players[0].hand);
  });

  it('computes currentAttackerId and currentDefenderId from the state indices', () => {
    const state = makeState();
    const snapshot = redactForPlayer(state, 'ua', {});
    expect(snapshot.currentAttackerId).toBe(state.players[state.currentAttackerIndex].id);
    expect(snapshot.currentDefenderId).toBe(state.players[state.currentDefenderIndex].id);
  });
});
