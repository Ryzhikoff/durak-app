/**
 * Test helpers. Not part of the public surface — referenced only by tests.
 */

import type { LobbySettings } from '@durak/shared-types';
import { DEFAULT_LOBBY_SETTINGS } from '@durak/shared-types';
import type { Card, GameState, PlayerSeat, Suit, Rank } from '../types.js';
import { createGame } from '../state/createGame.js';
import { makeStandardId } from '../deck/card.js';

export function makeSeats(count: number): PlayerSeat[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    nickname: `Player ${i + 1}`,
  }));
}

export function makeSettings(overrides: Partial<LobbySettings> = {}): LobbySettings {
  return { ...DEFAULT_LOBBY_SETTINGS, ...overrides };
}

export function makeGame(
  overrides: Partial<{
    seed: number;
    playerCount: number;
    settings: Partial<LobbySettings>;
    previousLoserId: string | null;
  }> = {},
): GameState {
  const seed = overrides.seed ?? 42;
  const seats = makeSeats(overrides.playerCount ?? 4);
  return createGame({
    id: 'game-1',
    seed,
    settings: makeSettings(overrides.settings),
    players: seats,
    previousLoserId: overrides.previousLoserId ?? null,
  });
}

export function card(suit: Suit, rank: Rank): Card {
  return { kind: 'standard', id: makeStandardId(suit, rank), suit, rank };
}

export function joker(color: 'red' | 'black'): Card {
  return { kind: 'joker', id: `joker-${color}`, color };
}

/**
 * Crafts a GameState directly without going through the random deal. Used by
 * tests that need to assert specific scenarios.
 */
export interface CraftedGameInput {
  players: Array<{ id: string; nickname?: string; hand: Card[] }>;
  attackerId: string;
  defenderId: string;
  trumpSuit: Suit | null;
  deck?: Card[];
  settings?: Partial<LobbySettings>;
  boutNumber?: number;
  initialDefenderHandSize?: number;
}

export function craftGame(input: CraftedGameInput): GameState {
  const settings = makeSettings(input.settings);
  const players = input.players.map((p, idx) => ({
    id: p.id,
    nickname: p.nickname ?? `Player ${idx + 1}`,
    hand: p.hand.slice(),
  }));
  const attackerIndex = players.findIndex((p) => p.id === input.attackerId);
  const defenderIndex = players.findIndex((p) => p.id === input.defenderId);
  if (attackerIndex === -1 || defenderIndex === -1) {
    throw new Error('craftGame: attacker/defender must be in players');
  }
  const initialAttempts: Record<string, number> = {};
  if (settings.cheatingEnabled) {
    for (const p of players) initialAttempts[p.id] = settings.cheatAttempts;
  }
  return {
    id: 'crafted',
    settings,
    players,
    currentAttackerIndex: attackerIndex,
    currentDefenderIndex: defenderIndex,
    trumpCard: null,
    trumpSuit: input.trumpSuit,
    deck: input.deck ?? [],
    discard: [],
    table: { attacks: [] },
    status: 'bout_attack',
    boutNumber: input.boutNumber ?? 1,
    initialDefenderHandSize: input.initialDefenderHandSize ?? players[defenderIndex].hand.length,
    finishedPlayers: [],
    loserPlayerId: null,
    passedPlayerIds: [],
    exclusiveLockReleased: false,
    cheatAttemptsRemaining: initialAttempts,
    randSeed: 0,
    rngState: 1,
    nextEntryId: 1,
  };
}

export type { GameState };
