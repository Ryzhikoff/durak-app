/**
 * Cheat policy. With cheating enabled, attack/beat commands are NOT validated
 * against beat/rank rules — any card in the player's hand may be played. The
 * cheat is "caught" only when another player issues `notice_cheat`.
 *
 * Notice scope:
 *  - `defender_only` — only the player on the receiving side of the suspected
 *    illegal action may notice it. For attack-cheats that is the current
 *    defender (they are the one being thrown extra cards at). For beat-cheats
 *    that is nobody — the defender obviously won't catch their own bad beat,
 *    and only the defender is on the "receiving side" of a beat in the
 *    duel-style scope.
 *  - `all`           — any non-cheater non-finished player may notice.
 */

import type { LobbySettings } from '@durak/shared-types';
import type { GameState, PlayerId } from '../types.js';

export interface ICheatPolicy {
  /**
   * May `noticerId` accuse `cheaterId` of cheating on the given action?
   *
   * `cheaterId` is the player who actually performed the suspected action:
   * - for an attack-cheat (`isBeatBeingChecked === false`), it's the player
   *   who placed the attack entry (taken from the entry's stored
   *   `attackerId`, so it stays accurate across translates);
   * - for a beat-cheat, it's the current defender.
   */
  canNotice(
    state: GameState,
    noticerId: PlayerId,
    cheaterId: PlayerId,
    isBeatBeingChecked: boolean,
  ): boolean;
}

export class DefaultCheatPolicy implements ICheatPolicy {
  canNotice(
    state: GameState,
    noticerId: PlayerId,
    cheaterId: PlayerId,
    isBeatBeingChecked: boolean,
  ): boolean {
    if (!state.settings.cheatingEnabled) return false;
    // Nobody can self-incriminate.
    if (noticerId === cheaterId) return false;
    if (state.finishedPlayers.includes(noticerId)) return false;

    const scope: LobbySettings['cheatNoticeScope'] = state.settings.cheatNoticeScope;
    if (scope === 'all') return true;
    // defender_only:
    //   * illegal attack -> only the defender may notice (they are the
    //     receiving side of the throw);
    //   * illegal beat   -> nobody may notice (defender would be accusing
    //     themselves; everybody else is out of scope).
    if (isBeatBeingChecked) return false;
    const defenderId = state.players[state.currentDefenderIndex].id;
    return noticerId === defenderId;
  }
}

export const defaultCheatPolicy: ICheatPolicy = new DefaultCheatPolicy();

/** Tally helpers — shared by reducers. */
export function getCheatAttempts(state: GameState, playerId: PlayerId): number {
  return state.cheatAttemptsRemaining[playerId] ?? state.settings.cheatAttempts;
}

export function decrementCheatAttempts(
  attempts: Record<PlayerId, number>,
  playerId: PlayerId,
  initial: number,
): Record<PlayerId, number> {
  const current = attempts[playerId] ?? initial;
  return { ...attempts, [playerId]: Math.max(0, current - 1) };
}
