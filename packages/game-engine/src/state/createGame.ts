/**
 * Game factory: build the initial `GameState` from a lobby settings + seated
 * players + RNG seed. Pluggable via the optional `deps` parameter — Phase 5
 * passes the production strategies; tests pass stubs.
 */

import type { LobbySettings } from '@durak/shared-types';
import type { Card, GameState, Player, PlayerId, PlayerSeat } from '../types.js';
import { createRng } from '../rng.js';
import { defaultDeckFactory, type IDeckFactory } from '../deck/factory.js';
import { defaultTrumpSelector, type ITrumpSelector } from '../strategies/trump.js';
import {
  STANDARD_HAND_SIZE,
  standardDealStrategy,
  type IDealStrategy,
} from '../strategies/deal.js';
import { firstPlayerFor } from '../strategies/first-player.js';
import { shuffle } from '../deck/shuffle.js';

export interface CreateGameInput {
  id: string;
  seed: number;
  settings: LobbySettings;
  players: PlayerSeat[];
  previousLoserId?: PlayerId | null;
}

export interface CreateGameDeps {
  deckFactory?: IDeckFactory;
  trumpSelector?: ITrumpSelector;
  dealStrategy?: IDealStrategy;
}

export function createGame(input: CreateGameInput, deps: CreateGameDeps = {}): GameState {
  const deckFactory = deps.deckFactory ?? defaultDeckFactory;
  const trumpSelector = deps.trumpSelector ?? defaultTrumpSelector;
  const dealStrategy = deps.dealStrategy ?? standardDealStrategy;

  if (input.players.length < 2) {
    throw new Error('createGame: at least 2 players required');
  }
  if (input.players.length > input.settings.maxPlayers) {
    throw new Error('createGame: more players than maxPlayers');
  }

  const rng = createRng(input.seed);
  const rawDeck: Card[] = deckFactory.build(input.settings);
  const shuffled = shuffle(rawDeck, rng);
  const { trumpCard, trumpSuit } = trumpSelector.select(shuffled);

  // Move the trump card to the bottom (index 0) so it's drawn last. We
  // remove it from its current position and re-insert at index 0.
  const working = shuffled.slice();
  if (trumpCard) {
    const idx = working.findIndex((c) => c.id === trumpCard.id);
    if (idx >= 0) {
      working.splice(idx, 1);
      working.unshift(trumpCard);
    }
  }

  const { hands, deck: afterDeal } = dealStrategy.deal(working, input.players, STANDARD_HAND_SIZE);

  const players: Player[] = input.players.map((seat) => ({
    id: seat.id,
    nickname: seat.nickname,
    hand: hands[seat.id] ?? [],
  }));

  const firstPlayerStrategy = firstPlayerFor(input.settings.firstTurn);
  const firstPlayerId = firstPlayerStrategy.pick({
    players,
    trumpSuit,
    previousLoserId: input.previousLoserId ?? null,
    rng,
  });

  const attackerIndex = players.findIndex((p) => p.id === firstPlayerId);
  const safeAttacker = attackerIndex === -1 ? 0 : attackerIndex;
  // No `finishedPlayers` yet, so the next seat is simply the next index.
  const defenderIndex = (safeAttacker + 1) % players.length;
  const defender = players[defenderIndex];

  const initialAttempts: Record<PlayerId, number> = {};
  if (input.settings.cheatingEnabled) {
    for (const p of players) {
      initialAttempts[p.id] = input.settings.cheatAttempts;
    }
  }

  return {
    id: input.id,
    settings: input.settings,
    players,
    currentAttackerIndex: safeAttacker,
    currentDefenderIndex: defenderIndex,
    trumpCard,
    trumpSuit,
    deck: afterDeal,
    discard: [],
    table: { attacks: [] },
    status: 'bout_attack',
    boutNumber: 1,
    initialDefenderHandSize: defender.hand.length,
    firstDefenseHappened: false,
    finishedPlayers: [],
    loserPlayerId: null,
    passedPlayerIds: [],
    exclusiveLockReleased: false,
    cheatAttemptsRemaining: initialAttempts,
    randSeed: input.seed,
    rngState: rng.getState(),
    nextEntryId: 1,
  };
}
