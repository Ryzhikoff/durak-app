/**
 * Phase 7A — per-game metrics collection.
 *
 * Lives next to GamesService. Called on every successful `applyCommand`, given:
 *   - state BEFORE the command (so we can tell legality of attacks / beats),
 *   - the command itself,
 *   - the domain events emitted by the engine.
 *
 * Emits a flat list of `MetricDelta`s the caller applies to a per-(game,user)
 * Redis HASH (HINCRBY). Game-over finalization reads those hashes and turns
 * them into `GameParticipant` rows.
 *
 * Design notes:
 *   - "Illegal" attacks/beats are only meaningful when cheatingEnabled=true.
 *     With cheating off, the engine rejects them up-front, so we never observe
 *     them downstream.
 *   - We track illegal-on-the-table entries in a separate "pending illegal"
 *     book (Redis HASH). When CheatNoticed succeeds we remove the entry from
 *     the book and mark it as "caught"; anything still in the book at
 *     BoutEnded escaped (cards leave the table as the bout closes).
 *   - Bouts-attacked / bouts-defended are credited at BoutEnded to whoever
 *     held the role AT THAT MOMENT (state BEFORE the command that closed the
 *     bout). This handles translates correctly: the original attacker/defender
 *     don't get credit if the bout was translated away from them — only the
 *     "final" attacker/defender of the bout do.
 */

import type { Card, DomainEvent, GameCommand, GameState, PlayerId } from '@durak/game-engine';
import { beats } from '@durak/game-engine';
import { isStandard } from '@durak/game-engine';

/** All counter names that can show up in a delta. */
export type MetricField =
  | 'attacksMade'
  | 'beatsMade'
  | 'translatesMade'
  | 'takesAsked'
  | 'cardsTaken'
  | 'boutsAttacked'
  | 'boutsDefended'
  | 'cheatAttemptedTotal'
  | 'cheatCaught'
  | 'cheatEscaped'
  | 'noticesIssued'
  | 'noticesCorrect'
  | 'noticesWrong';

export interface MetricDelta {
  userId: PlayerId;
  field: MetricField;
  delta: number;
}

/** "Illegal entry" book entry — value stored in Redis next to gameId. */
export interface PendingIllegalEntry {
  entryId: string;
  cheaterId: PlayerId;
}

export interface CollectorInput {
  /** State BEFORE the engine processed the command. */
  stateBefore: GameState;
  /** The command that was just applied. */
  command: GameCommand;
  /** Events emitted by the engine for this command. */
  events: readonly DomainEvent[];
  /** Snapshot of the "pending illegal" book BEFORE this command. */
  pendingIllegal: PendingIllegalEntry[];
}

export interface CollectorOutput {
  /** Counter increments to apply to per-user HASHes. */
  deltas: MetricDelta[];
  /** Entries to add to the "pending illegal" book. */
  addIllegal: PendingIllegalEntry[];
  /**
   * EntryIds to drop from the "pending illegal" book — caused by a successful
   * CheatNoticed (caught) or by BoutEnded sweeping everything still on the
   * table (escaped). The caller writes the deltas first, then prunes.
   */
  dropIllegalEntryIds: string[];
  /**
   * When BoutEnded ran, this is true and the caller should clear the entire
   * pending-illegal book afterwards (any entries remaining at that moment had
   * already been counted as "escaped" in `deltas`).
   */
  clearAllIllegal: boolean;
}

function isFirstAttackOfBout(state: GameState): boolean {
  return state.table.attacks.length === 0;
}

function ranksOnTable(state: GameState): Set<number> {
  const out = new Set<number>();
  for (const e of state.table.attacks) {
    if (isStandard(e.card)) out.add(e.card.rank);
    if (e.beatenBy && isStandard(e.beatenBy)) out.add(e.beatenBy.rank);
  }
  return out;
}

function isAttackIllegal(stateBefore: GameState, card: Card): boolean {
  // Opening attack is always legal.
  if (isFirstAttackOfBout(stateBefore)) return false;
  // Jokers always match any rank.
  if (!isStandard(card)) return false;
  return !ranksOnTable(stateBefore).has(card.rank);
}

function isBeatIllegal(stateBefore: GameState, attackEntryId: string, defenseCard: Card): boolean {
  const entry = stateBefore.table.attacks.find((a) => a.id === attackEntryId);
  if (!entry) return false;
  return !beats(defenseCard, entry.card, stateBefore.trumpSuit);
}

/**
 * Build the per-command metric deltas + pending-illegal book diff.
 *
 * Pure: no Redis / DB access. The caller plumbs Redis HINCRBYs and HASH
 * updates around the result.
 */
export function collectMetrics(input: CollectorInput): CollectorOutput {
  const { stateBefore, command, events } = input;
  const deltas: MetricDelta[] = [];
  const addIllegal: PendingIllegalEntry[] = [];
  const dropIllegalEntryIds: string[] = [];
  let clearAllIllegal = false;

  const cheatingEnabled = stateBefore.settings.cheatingEnabled;

  for (const ev of events) {
    switch (ev.type) {
      case 'CardAttacked': {
        deltas.push({ userId: ev.playerId, field: 'attacksMade', delta: 1 });
        if (cheatingEnabled && isAttackIllegal(stateBefore, ev.card)) {
          deltas.push({ userId: ev.playerId, field: 'cheatAttemptedTotal', delta: 1 });
          addIllegal.push({ entryId: ev.entryId, cheaterId: ev.playerId });
        }
        break;
      }
      case 'CardBeaten': {
        deltas.push({ userId: ev.defenderId, field: 'beatsMade', delta: 1 });
        if (cheatingEnabled && isBeatIllegal(stateBefore, ev.attackEntryId, ev.defenseCard)) {
          deltas.push({ userId: ev.defenderId, field: 'cheatAttemptedTotal', delta: 1 });
          // Beat-on-attack: track under the attack-entry id so a notice_cheat
          // on the same entry clears it. A second beat on the same entry is
          // impossible (engine refuses), so collisions don't matter.
          addIllegal.push({ entryId: ev.attackEntryId, cheaterId: ev.defenderId });
        }
        break;
      }
      case 'CardTranslated': {
        deltas.push({ userId: ev.fromPlayerId, field: 'translatesMade', delta: 1 });
        if (cheatingEnabled) {
          // A translate inserts a fresh attack entry. The engine validates
          // it via translate-policy (rank match against attacker), so a
          // translate is never illegal in the cheat sense — we don't add it
          // to the illegal book.
        }
        break;
      }
      case 'DefenderTookCalled': {
        deltas.push({ userId: ev.defenderId, field: 'takesAsked', delta: 1 });
        break;
      }
      case 'CardsTaken': {
        deltas.push({ userId: ev.defenderId, field: 'cardsTaken', delta: ev.count });
        break;
      }
      case 'CheatNoticed': {
        deltas.push({ userId: ev.noticerId, field: 'noticesIssued', delta: 1 });
        if (ev.succeeded) {
          deltas.push({ userId: ev.noticerId, field: 'noticesCorrect', delta: 1 });
          if (ev.cheaterId) {
            deltas.push({ userId: ev.cheaterId, field: 'cheatCaught', delta: 1 });
          }
          dropIllegalEntryIds.push(ev.attackEntryId);
        } else {
          deltas.push({ userId: ev.noticerId, field: 'noticesWrong', delta: 1 });
        }
        break;
      }
      case 'BoutEnded': {
        // Credit the actors who finished this bout. We use STATE BEFORE the
        // command since the engine has already rotated roles in `nextState`.
        const attackerId = stateBefore.players[stateBefore.currentAttackerIndex].id;
        const defenderId = stateBefore.players[stateBefore.currentDefenderIndex].id;
        deltas.push({ userId: attackerId, field: 'boutsAttacked', delta: 1 });
        deltas.push({ userId: defenderId, field: 'boutsDefended', delta: 1 });

        // Sweep illegal book: anything still in there at the end of a bout
        // counts as "escaped" for its cheater. Avoid double-counting entries
        // that were already dropped via CheatNoticed earlier in the same
        // command's events.
        const droppedSet = new Set(dropIllegalEntryIds);
        const startCounted = new Set<string>();
        for (const pe of input.pendingIllegal) {
          if (droppedSet.has(pe.entryId)) continue;
          if (startCounted.has(pe.entryId)) continue;
          deltas.push({ userId: pe.cheaterId, field: 'cheatEscaped', delta: 1 });
          startCounted.add(pe.entryId);
        }
        // Also any entries added DURING this command (e.g. a take that closes
        // the bout with an illegal attack that arrived in the same command).
        for (const pe of addIllegal) {
          if (droppedSet.has(pe.entryId)) continue;
          if (startCounted.has(pe.entryId)) continue;
          deltas.push({ userId: pe.cheaterId, field: 'cheatEscaped', delta: 1 });
          startCounted.add(pe.entryId);
        }
        clearAllIllegal = true;
        break;
      }
      case 'PlayerOut':
      case 'GameEnded':
      case 'TablePassed':
      case 'TurnPassed':
      case 'PlayersDrew':
        // Not used for metric counters.
        break;
      default: {
        const _exhaustive: never = ev;
        void _exhaustive;
        break;
      }
    }
  }

  // Unused — kept for symmetry / future use.
  void command;

  return { deltas, addIllegal, dropIllegalEntryIds, clearAllIllegal };
}
