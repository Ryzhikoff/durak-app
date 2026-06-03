/**
 * Cheat policy. With cheating enabled, attack/beat commands are NOT validated
 * against beat/rank rules — any card in the player's hand may be played. The
 * cheat is "caught" only when another player issues `notice_cheat`.
 *
 * `cheatNoticeScope` ONLY constrains who can catch an **attacker** cheating:
 *  - `defender_only` — only the current defender may notice an illegal attack.
 *  - `all`           — any non-attacker non-finished player may notice it.
 *
 * Beat-cheats (the defender plays a card that doesn't beat) are ALWAYS
 * catchable by anyone except the defender themselves, regardless of
 * `cheatNoticeScope`. The defender alone benefits from a successful bad beat,
 * so every other live player is on the "receiving side" and may call it.
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

    // Beat-cheats: the defender benefits from a bad beat, everyone else is
    // on the receiving side. `cheatNoticeScope` only governs attack-cheats.
    if (isBeatBeingChecked) return true;

    const scope: LobbySettings['cheatNoticeScope'] = state.settings.cheatNoticeScope;
    if (scope === 'all') return true;
    // defender_only: only the current defender catches illegal attacks.
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
