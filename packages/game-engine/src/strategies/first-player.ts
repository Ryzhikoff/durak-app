/**
 * First-player strategy. Three variants matching `LobbySettings.firstTurn`:
 *
 * - `lowest_trump`  : player holding the lowest trump card.
 * - `random`        : seeded random pick.
 * - `previous_loser`: caller passes the previous game's loser id; if absent
 *                     or not in seat list, falls back to `lowest_trump`.
 */

import type { LobbySettings } from '@durak/shared-types';
import type { PlayerId, Player, Suit } from '../types.js';
import { cardSortValue, isStandard } from '../deck/card.js';
import type { Rng } from '../rng.js';

export interface FirstPlayerContext {
  players: readonly Player[];
  trumpSuit: Suit | null;
  /** Caller-provided when `firstTurn === 'previous_loser'`. */
  previousLoserId: PlayerId | null;
  rng: Rng;
}

export interface IFirstPlayerStrategy {
  pick(ctx: FirstPlayerContext): PlayerId;
}

export class LowestTrumpFirstPlayer implements IFirstPlayerStrategy {
  pick(ctx: FirstPlayerContext): PlayerId {
    const { players, trumpSuit } = ctx;
    let bestPlayer: Player = players[0];
    let bestValue = Number.MAX_SAFE_INTEGER;
    for (const player of players) {
      for (const card of player.hand) {
        if (!isStandard(card)) continue;
        if (trumpSuit === null || card.suit !== trumpSuit) continue;
        const value = cardSortValue(card, trumpSuit);
        if (value < bestValue) {
          bestValue = value;
          bestPlayer = player;
        }
      }
    }
    // Nobody has a trump (small deck + bad shuffle) → first seated player.
    return bestPlayer.id;
  }
}

export class RandomFirstPlayer implements IFirstPlayerStrategy {
  pick(ctx: FirstPlayerContext): PlayerId {
    const { players, rng } = ctx;
    return players[rng.nextInt(0, players.length)].id;
  }
}

export class PreviousLoserFirstPlayer implements IFirstPlayerStrategy {
  pick(ctx: FirstPlayerContext): PlayerId {
    const { players, previousLoserId } = ctx;
    if (previousLoserId && players.some((p) => p.id === previousLoserId)) {
      return previousLoserId;
    }
    return new LowestTrumpFirstPlayer().pick(ctx);
  }
}

export function firstPlayerFor(setting: LobbySettings['firstTurn']): IFirstPlayerStrategy {
  switch (setting) {
    case 'lowest_trump':
      return new LowestTrumpFirstPlayer();
    case 'random':
      return new RandomFirstPlayer();
    case 'previous_loser':
      return new PreviousLoserFirstPlayer();
  }
}
