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
 *
 * On top of the scope rule, `LobbySettings.exclusiveThrowIn` can be set to
 * `true` to lock all throw-ins behind the current primary attacker's "бито".
 * While the primary attacker has cards left and has NOT yet pasted on this
 * bout, every other non-defender player is blocked from attacking. As soon
 * as the primary attacker says "бито" (recorded in `state.passedPlayerIds`),
 * the throw-in window opens to the rest per the underlying policy.
 */

import type { LobbySettings } from '@durak/shared-types';
import type { GameState, PlayerId } from '../types.js';

/**
 * Why a `canThrow` call rejected the request. Reducers map this onto the
 * engine's `CommandErrorCode` so the frontend can pick a localized message.
 *
 * - `DEFENDER`        — defender tried to throw.
 * - `FINISHED`        — finished player tried to throw.
 * - `NOT_ATTACKER`    — `attackerScope='attacker_only'` and the caller is
 *                      not the current attacker.
 * - `EXCLUSIVE_LOCK`  — `exclusiveThrowIn=true` and the primary attacker has
 *                      not yet said "бито".
 */
export type AttackRejectionReason =
  | 'DEFENDER'
  | 'FINISHED'
  | 'NOT_ATTACKER'
  | 'EXCLUSIVE_LOCK';

export interface IAttackPolicy {
  canThrow(state: GameState, playerId: PlayerId): boolean;
  /**
   * Same as `canThrow` but returns a structured rejection reason so reducers
   * can map the failure onto a specific error code. Implementations must
   * return `{ ok: true }` exactly when `canThrow` returns true.
   */
  checkThrow(state: GameState, playerId: PlayerId): { ok: true } | { ok: false; reason: AttackRejectionReason };
}

export class AttackerOnlyPolicy implements IAttackPolicy {
  canThrow(state: GameState, playerId: PlayerId): boolean {
    return this.checkThrow(state, playerId).ok;
  }
  checkThrow(state: GameState, playerId: PlayerId): { ok: true } | { ok: false; reason: AttackRejectionReason } {
    if (playerId === state.players[state.currentDefenderIndex].id) {
      return { ok: false, reason: 'DEFENDER' };
    }
    if (state.finishedPlayers.includes(playerId)) {
      return { ok: false, reason: 'FINISHED' };
    }
    if (state.players[state.currentAttackerIndex].id !== playerId) {
      return { ok: false, reason: 'NOT_ATTACKER' };
    }
    return { ok: true };
  }
}

export class AllPlayersPolicy implements IAttackPolicy {
  canThrow(state: GameState, playerId: PlayerId): boolean {
    return this.checkThrow(state, playerId).ok;
  }
  checkThrow(state: GameState, playerId: PlayerId): { ok: true } | { ok: false; reason: AttackRejectionReason } {
    if (playerId === state.players[state.currentDefenderIndex].id) {
      return { ok: false, reason: 'DEFENDER' };
    }
    if (state.finishedPlayers.includes(playerId)) {
      return { ok: false, reason: 'FINISHED' };
    }
    return { ok: true };
  }
}

/**
 * Decorator that wraps an inner policy and additionally enforces the
 * "primary attacker pasts first" rule from {@link LobbySettings.exclusiveThrowIn}.
 *
 * Until the primary attacker (= `state.currentAttackerIndex` — translates
 * already rotate this index in the reducer) has either:
 *   - said "бито" (id present in `state.passedPlayerIds`), or
 *   - exited the game (`finishedPlayers`), or
 *   - run out of cards (empty hand)
 * every OTHER player's throw-in is rejected with `EXCLUSIVE_LOCK`.
 *
 * The primary attacker themselves is always evaluated by the underlying
 * policy — no self-blocking.
 */
export class ExclusiveThrowInPolicy implements IAttackPolicy {
  constructor(private readonly inner: IAttackPolicy) {}

  canThrow(state: GameState, playerId: PlayerId): boolean {
    return this.checkThrow(state, playerId).ok;
  }

  checkThrow(state: GameState, playerId: PlayerId): { ok: true } | { ok: false; reason: AttackRejectionReason } {
    const innerCheck = this.inner.checkThrow(state, playerId);
    if (!innerCheck.ok) return innerCheck;

    // Find the primary attacker — the seat currently flagged as attacker.
    // `translate` rotates this index inside the reducer; `passedPlayerIds`
    // is reset on translate too (see reducers.ts), so the lock re-engages
    // for whoever holds the role.
    const primary = state.players[state.currentAttackerIndex];
    if (!primary) return innerCheck;
    if (primary.id === playerId) return innerCheck;
    // Primary attacker out of game — exclusivity gates nothing.
    if (state.finishedPlayers.includes(primary.id)) return innerCheck;
    // Primary attacker already said "бито" for this bout — lock released.
    if (state.passedPlayerIds.includes(primary.id)) return innerCheck;
    // Primary attacker has no cards left → can't throw anymore. Treat as
    // implicit pass: don't block the rest of the table.
    if (primary.hand.length === 0) return innerCheck;
    return { ok: false, reason: 'EXCLUSIVE_LOCK' };
  }
}

/**
 * Build the effective attack policy for the given settings. Combines the
 * scope-driven base policy (`AllPlayersPolicy` / `AttackerOnlyPolicy`) with
 * the optional `exclusiveThrowIn` decorator.
 */
export function attackPolicyFor(
  setting: LobbySettings['attackerScope'],
  exclusiveThrowIn: boolean = false,
): IAttackPolicy {
  const base: IAttackPolicy =
    setting === 'all' ? new AllPlayersPolicy() : new AttackerOnlyPolicy();
  return exclusiveThrowIn ? new ExclusiveThrowInPolicy(base) : base;
}
