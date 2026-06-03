/**
 * Attack policy. Decides who may put extra cards on the table during the
 * current bout. Two variants, mapped from `LobbySettings.attackerScope`:
 *
 * - `attacker_only` — only the original attacker (or the player who last
 *   translated into being attacker) may throw extra cards.
 * - `all`           — every non-defender player may throw extra cards (the
 *   classic "общая подкидка" variant).
 *
 * The defender is NEVER allowed to throw (they translate / take / beat).
 */

import type { LobbySettings } from '@durak/shared-types';
import type { GameState, PlayerId } from '../types.js';

export interface IAttackPolicy {
  canThrow(state: GameState, playerId: PlayerId): boolean;
}

export class AttackerOnlyPolicy implements IAttackPolicy {
  canThrow(state: GameState, playerId: PlayerId): boolean {
    if (playerId === state.players[state.currentDefenderIndex].id) return false;
    return state.players[state.currentAttackerIndex].id === playerId;
  }
}

export class AllPlayersPolicy implements IAttackPolicy {
  canThrow(state: GameState, playerId: PlayerId): boolean {
    if (playerId === state.players[state.currentDefenderIndex].id) return false;
    // Finished players can no longer throw.
    return !state.finishedPlayers.includes(playerId);
  }
}

export function attackPolicyFor(setting: LobbySettings['attackerScope']): IAttackPolicy {
  return setting === 'all' ? new AllPlayersPolicy() : new AttackerOnlyPolicy();
}
