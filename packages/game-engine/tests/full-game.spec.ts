/**
 * Integration smoke test: drives a 4-player game to completion using a
 * simple greedy "bot" controller. The point isn't to test bot quality — it's
 * to assert that the engine can run a full bout-rotation cycle end-to-end
 * without deadlocking and that it eventually emits `GameEnded`.
 */

import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/state/reducers.js';
import { createGame } from '../src/state/createGame.js';
import { beats, isStandard } from '../src/deck/card.js';
import { attacksRemaining } from '../src/state/transitions.js';
import { makeSettings, makeSeats } from '../src/_testing/fixtures.js';
import type {
  Card,
  CommandResult,
  DomainEvent,
  GameCommand,
  GameState,
  PlayerId,
} from '../src/types.js';

function sortByRankAsc(hand: readonly Card[]): Card[] {
  return hand.slice().sort((a, b) => {
    const ra = isStandard(a) ? a.rank : 99;
    const rb = isStandard(b) ? b.rank : 99;
    return ra - rb;
  });
}

function pickAttackerCard(state: GameState, attackerId: PlayerId): Card | null {
  const attacker = state.players.find((p) => p.id === attackerId);
  if (!attacker || attacker.hand.length === 0) return null;
  const tableRanks = new Set<number>();
  for (const entry of state.table.attacks) {
    if (isStandard(entry.card)) tableRanks.add(entry.card.rank);
    if (entry.beatenBy && isStandard(entry.beatenBy)) {
      tableRanks.add(entry.beatenBy.rank);
    }
  }
  const sorted = sortByRankAsc(attacker.hand);
  if (state.table.attacks.length === 0) {
    // Opening — play lowest non-trump if possible, else lowest.
    const nonTrump = sorted.find((c) => isStandard(c) && c.suit !== state.trumpSuit);
    return nonTrump ?? sorted[0];
  }
  // Throw a same-rank non-trump first.
  const sameRankNonTrump = sorted.find(
    (c) => isStandard(c) && tableRanks.has(c.rank) && c.suit !== state.trumpSuit,
  );
  if (sameRankNonTrump) return sameRankNonTrump;
  const sameRank = sorted.find((c) => isStandard(c) && tableRanks.has(c.rank));
  return sameRank ?? null;
}

function pickDefenseCard(
  state: GameState,
  defenderId: PlayerId,
): {
  attackEntryId: string;
  defenseCardId: string;
} | null {
  const defender = state.players.find((p) => p.id === defenderId);
  if (!defender) return null;
  // For each un-beaten attack, find the lowest card that beats it.
  for (const entry of state.table.attacks) {
    if (entry.beatenBy) continue;
    const sorted = sortByRankAsc(defender.hand);
    // Prefer non-trump beat.
    const nonTrump = sorted.find(
      (c) => isStandard(c) && c.suit !== state.trumpSuit && beats(c, entry.card, state.trumpSuit),
    );
    const trump = sorted.find((c) => beats(c, entry.card, state.trumpSuit));
    const pick = nonTrump ?? trump;
    if (!pick) return null; // can't beat — caller will take.
    return { attackEntryId: entry.id, defenseCardId: pick.id };
  }
  return null;
}

function nextCommand(state: GameState): GameCommand | null {
  if (state.status === 'game_over') return null;
  const attacker = state.players[state.currentAttackerIndex];
  const defender = state.players[state.currentDefenderIndex];

  // Need first attack of a bout?
  if (state.status === 'bout_attack') {
    const c = pickAttackerCard(state, attacker.id);
    if (!c) return null;
    return { type: 'attack', playerId: attacker.id, cardId: c.id };
  }

  // Defender must act in bout_defense.
  if (state.status === 'bout_defense') {
    const def = pickDefenseCard(state, defender.id);
    if (def) {
      return { type: 'beat', playerId: defender.id, ...def };
    }
    return { type: 'take', playerId: defender.id };
  }

  // bout_settle: try throwing extras, else everyone passes.
  if (state.status === 'bout_settle') {
    // Eligible throwers: non-defender, non-finished, who can throw.
    const eligible = state.players.filter(
      (p) =>
        p.id !== defender.id &&
        !state.finishedPlayers.includes(p.id) &&
        !state.passedPlayerIds.includes(p.id),
    );
    // Only attempt to throw if there is still capacity in the bout.
    if (attacksRemaining(state) > 0) {
      for (const p of eligible) {
        // Settings.attackerScope may forbid non-attacker throws.
        if (state.settings.attackerScope === 'attacker_only' && p.id !== attacker.id) continue;
        const c = pickAttackerCard(state, p.id);
        if (c) {
          return { type: 'attack', playerId: p.id, cardId: c.id };
        }
      }
    }
    // Nobody wants to throw — pass.
    const next = eligible[0];
    if (next) return { type: 'pass', playerId: next.id };
    return null;
  }
  return null;
}

describe('full-game smoke test', () => {
  it('runs a 4-player game to completion with seed=42', () => {
    const settings = makeSettings({
      // Disable cheating to avoid bot needing to reason about it.
      cheatingEnabled: false,
      attackerScope: 'all',
      firstBoutLimit: 5,
      deckSize: 36,
      jokers: false,
      firstTurn: 'lowest_trump',
    });
    let state = createGame({
      id: 'smoke',
      seed: 42,
      settings,
      players: makeSeats(4),
      previousLoserId: null,
    });

    const events: DomainEvent[] = [];
    const MAX_STEPS = 5000;
    let steps = 0;
    while (state.status !== 'game_over' && steps < MAX_STEPS) {
      const cmd = nextCommand(state);
      if (!cmd) throw new Error(`bot has no move (status=${state.status}); deadlock`);
      const res: CommandResult = applyCommand(state, cmd);
      if (!res.ok) {
        throw new Error(`unexpected command failure at step ${steps}: ${res.code} ${res.message}`);
      }
      state = res.state;
      events.push(...res.events);
      steps++;
    }
    expect(state.status).toBe('game_over');
    const ended = events.find((e) => e.type === 'GameEnded');
    expect(ended).toBeDefined();
    if (ended && ended.type === 'GameEnded') {
      // Either a loser or a draw — both are valid endings.
      expect(typeof ended.loserId === 'string' || ended.loserId === null).toBe(true);
      // Placements must cover every player.
      expect(ended.placements.length).toBe(4);
    }
  });
});
