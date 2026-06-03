import { describe, expect, it } from 'vitest';
import { createGame } from '../src/state/createGame.js';
import { makeSeats, makeSettings } from '../src/_testing/fixtures.js';

describe('createGame', () => {
  it('deals 6 cards to each player', () => {
    const game = createGame({
      id: 'g',
      seed: 42,
      settings: makeSettings(),
      players: makeSeats(4),
    });
    for (const p of game.players) {
      expect(p.hand).toHaveLength(6);
    }
  });

  it('deck is reduced by 6 × playerCount', () => {
    const game = createGame({
      id: 'g',
      seed: 42,
      settings: makeSettings({ deckSize: 36 }),
      players: makeSeats(4),
    });
    expect(game.deck.length).toBe(36 - 4 * 6);
  });

  it('trumpSuit is set and trumpCard exists', () => {
    const game = createGame({
      id: 'g',
      seed: 42,
      settings: makeSettings(),
      players: makeSeats(4),
    });
    expect(game.trumpSuit).not.toBeNull();
    expect(game.trumpCard).not.toBeNull();
  });

  it('trump card sits at the BOTTOM of the deck (index 0)', () => {
    const game = createGame({
      id: 'g',
      seed: 42,
      settings: makeSettings(),
      players: makeSeats(4),
    });
    expect(game.deck[0].id).toBe(game.trumpCard?.id);
  });

  it('attacker and defender are different active players', () => {
    const game = createGame({
      id: 'g',
      seed: 1,
      settings: makeSettings(),
      players: makeSeats(4),
    });
    expect(game.currentAttackerIndex).not.toBe(game.currentDefenderIndex);
  });

  it('status begins at bout_attack', () => {
    const game = createGame({
      id: 'g',
      seed: 1,
      settings: makeSettings(),
      players: makeSeats(4),
    });
    expect(game.status).toBe('bout_attack');
  });

  it('boutNumber starts at 1', () => {
    const game = createGame({
      id: 'g',
      seed: 1,
      settings: makeSettings(),
      players: makeSeats(4),
    });
    expect(game.boutNumber).toBe(1);
  });

  it('initialDefenderHandSize equals 6', () => {
    const game = createGame({
      id: 'g',
      seed: 1,
      settings: makeSettings(),
      players: makeSeats(4),
    });
    expect(game.initialDefenderHandSize).toBe(6);
  });

  it('cheatAttemptsRemaining seeded per player when cheating enabled', () => {
    const game = createGame({
      id: 'g',
      seed: 1,
      settings: makeSettings({ cheatingEnabled: true, cheatAttempts: 3 }),
      players: makeSeats(4),
    });
    for (const p of game.players) {
      expect(game.cheatAttemptsRemaining[p.id]).toBe(3);
    }
  });

  it('cheatAttemptsRemaining is empty when cheating disabled', () => {
    const game = createGame({
      id: 'g',
      seed: 1,
      settings: makeSettings({ cheatingEnabled: false }),
      players: makeSeats(4),
    });
    expect(Object.keys(game.cheatAttemptsRemaining)).toHaveLength(0);
  });

  it('throws if fewer than 2 players', () => {
    expect(() =>
      createGame({
        id: 'g',
        seed: 1,
        settings: makeSettings(),
        players: makeSeats(1),
      }),
    ).toThrow();
  });

  it('throws if more players than maxPlayers', () => {
    expect(() =>
      createGame({
        id: 'g',
        seed: 1,
        settings: makeSettings({ maxPlayers: 2 }),
        players: makeSeats(3),
      }),
    ).toThrow();
  });

  it('is deterministic across two runs with same seed', () => {
    const a = createGame({
      id: 'g',
      seed: 42,
      settings: makeSettings(),
      players: makeSeats(4),
    });
    const b = createGame({
      id: 'g',
      seed: 42,
      settings: makeSettings(),
      players: makeSeats(4),
    });
    expect(a.deck.map((c) => c.id)).toEqual(b.deck.map((c) => c.id));
    expect(a.players.map((p) => p.hand.map((c) => c.id))).toEqual(
      b.players.map((p) => p.hand.map((c) => c.id)),
    );
    expect(a.currentAttackerIndex).toBe(b.currentAttackerIndex);
  });
});
