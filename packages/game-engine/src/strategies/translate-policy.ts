/**
 * Translate policy. Decides whether a defender is allowed to convert a defence
 * into a translation onto the next player. The default rule mirrors the
 * canonical "перевод":
 *
 *  - the defender has not yet beaten ANY of the existing attacks (`beatenBy`
 *    is null for every entry),
 *  - every attack on the table currently shares the SAME rank,
 *  - the translation card has the same rank as the attacks,
 *  - the next-defender's hand size is greater than the new total attack count
 *    (after this translation card is added).
 */

import type { Card, GameState, PlayerId, Player } from '../types.js';
import { isJoker, isStandard } from '../deck/card.js';

export interface TranslateCheck {
  ok: boolean;
  reason?: string;
}

export interface ITranslatePolicy {
  canTranslate(state: GameState, defenderId: PlayerId, card: Card): TranslateCheck;
}

export class DefaultTranslatePolicy implements ITranslatePolicy {
  canTranslate(state: GameState, defenderId: PlayerId, card: Card): TranslateCheck {
    const defenderIndex = state.players.findIndex((p) => p.id === defenderId);
    if (defenderIndex === -1 || defenderIndex !== state.currentDefenderIndex) {
      return { ok: false, reason: 'NOT_DEFENDER' };
    }
    // No defence yet.
    const anyBeaten = state.table.attacks.some((a) => a.beatenBy !== null);
    if (anyBeaten) {
      return { ok: false, reason: 'ALREADY_DEFENDING' };
    }
    if (state.table.attacks.length === 0) {
      return { ok: false, reason: 'NO_ATTACKS' };
    }
    // All attacks share the same rank.
    const firstAttack = state.table.attacks[0].card;
    if (!isStandard(firstAttack) || isJoker(card)) {
      // Translating with/onto a joker is not supported.
      return { ok: false, reason: 'JOKER_RULE' };
    }
    if (!isStandard(card)) {
      return { ok: false, reason: 'NOT_STANDARD' };
    }
    for (const entry of state.table.attacks) {
      if (!isStandard(entry.card) || entry.card.rank !== firstAttack.rank) {
        return { ok: false, reason: 'MIXED_RANKS' };
      }
    }
    if (card.rank !== firstAttack.rank) {
      return { ok: false, reason: 'RANK_MISMATCH' };
    }
    // New defender must have enough cards (> attack count) to legally defend
    // a translated stack of (current attacks + this one).
    const nextDefender = nextActivePlayer(state, defenderIndex);
    if (!nextDefender) {
      return { ok: false, reason: 'NO_NEXT_DEFENDER' };
    }
    const newAttackCount = state.table.attacks.length + 1;
    if (nextDefender.hand.length < newAttackCount) {
      return { ok: false, reason: 'NEW_DEFENDER_HAND_TOO_SMALL' };
    }
    return { ok: true };
  }
}

export const defaultTranslatePolicy: ITranslatePolicy = new DefaultTranslatePolicy();

/**
 * Helper shared with reducers — find the next active (= not finished) player.
 */
export function nextActivePlayer(state: GameState, fromIndex: number): Player | null {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (fromIndex + step) % n;
    const p = state.players[idx];
    if (!state.finishedPlayers.includes(p.id)) {
      return p;
    }
  }
  return null;
}

export function nextActivePlayerIndex(state: GameState, fromIndex: number): number {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (fromIndex + step) % n;
    const p = state.players[idx];
    if (!state.finishedPlayers.includes(p.id)) {
      return idx;
    }
  }
  return fromIndex;
}
