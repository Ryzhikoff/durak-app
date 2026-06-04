/**
 * State-machine helpers: bout closure (beaten / taken / translated),
 * hand refill, end-of-game detection, defender capacity caps.
 *
 * Reducers in `reducers.ts` call into these; nothing here knows about
 * commands.
 */

import type { Card, DomainEvent, GameState, Player, PlayerId } from '../types.js';
import { STANDARD_HAND_SIZE } from '../strategies/deal.js';
import { defaultFirstBoutLimit } from '../strategies/first-bout-limit.js';
import { nextActivePlayerIndex } from '../strategies/translate-policy.js';

/**
 * Maximum number of NEW attack cards that can still be added on top of the
 * current table. Takes into account:
 *  - the per-bout cap (`firstBoutLimit` strategy),
 *  - the defender's hand size AT THE START OF THE BOUT — not current. The
 *    standard rule is "defender must beat as many cards as they could have
 *    held when the bout opened"; once they've started beating, their current
 *    hand shrinks, but the bout cap stays tied to the initial size, otherwise
 *    a defender who beat 2 cards from a 4-card hand would suddenly be immune
 *    to any further throw-ins despite having room to beat them.
 *  - cards already on the table.
 */
export function attacksRemaining(state: GameState): number {
  const cap = defaultFirstBoutLimit.limit(state);
  const headroom = Math.min(cap, state.initialDefenderHandSize);
  return Math.max(0, headroom - state.table.attacks.length);
}

/** True iff every attack on the table has been beaten. */
export function tableFullyBeaten(state: GameState): boolean {
  if (state.table.attacks.length === 0) return false;
  return state.table.attacks.every((a) => a.beatenBy !== null);
}

/** True iff there is at least one un-beaten attack. */
export function tableHasUnbeaten(state: GameState): boolean {
  return state.table.attacks.some((a) => a.beatenBy === null);
}

/**
 * Refills hands to `STANDARD_HAND_SIZE` from the deck (top = end of array).
 * Order: attacker → other throwers in seat order from attacker → defender
 * last. Finished players are skipped. If `options.skipPlayerId` is provided,
 * that player is omitted from the refill entirely (used after a "take" where
 * the defender doesn't draw).
 *
 * Returns a new state plus a single `PlayersDrew` event aggregating the draws.
 */
export interface RefillOptions {
  /** Player who should NOT draw this round (e.g. the defender after take). */
  skipPlayerId?: PlayerId;
}

export function refillHands(
  state: GameState,
  attackerId: PlayerId,
  defenderId: PlayerId,
  options: RefillOptions = {},
): { state: GameState; event: DomainEvent } {
  const playersById = new Map<PlayerId, Player>();
  for (const p of state.players) {
    playersById.set(p.id, { ...p, hand: p.hand.slice() });
  }
  const deck = state.deck.slice();

  const attackerIndex = state.players.findIndex((p) => p.id === attackerId);
  const order: PlayerId[] = [];
  const n = state.players.length;
  const skipId = options.skipPlayerId;
  // Attacker first, then the others in seat order around the circle.
  for (let step = 0; step < n; step++) {
    const idx = (attackerIndex + step) % n;
    const id = state.players[idx].id;
    if (id === defenderId) continue;
    if (id === skipId) continue;
    if (state.finishedPlayers.includes(id)) continue;
    order.push(id);
  }
  // Defender draws last (standard rule) — but only when not explicitly
  // skipped (e.g. they just took the bout and are penalised one round).
  if (defenderId !== skipId && !state.finishedPlayers.includes(defenderId)) {
    order.push(defenderId);
  }

  const draws: Array<{ playerId: PlayerId; count: number }> = [];
  for (const playerId of order) {
    const player = playersById.get(playerId);
    if (!player) continue;
    let drawn = 0;
    while (player.hand.length < STANDARD_HAND_SIZE && deck.length > 0) {
      const card = deck.pop();
      if (!card) break;
      player.hand.push(card);
      drawn++;
    }
    if (drawn > 0) draws.push({ playerId, count: drawn });
  }

  const nextPlayers = state.players.map((p) => playersById.get(p.id) ?? p);
  const nextState: GameState = { ...state, players: nextPlayers, deck };
  return { state: nextState, event: { type: 'PlayersDrew', draws } };
}

/**
 * Finalises the current bout with a `beaten` outcome:
 *   - sweep table into discard,
 *   - refill hands,
 *   - mark players finished if applicable,
 *   - rotate attacker → ex-defender, defender → next after ex-defender,
 *   - bump boutNumber,
 *   - reset per-bout cheat attempts.
 *
 * Caller is responsible for emitting BoutEnded.
 */
export function closeBoutBeaten(state: GameState): {
  state: GameState;
  events: DomainEvent[];
} {
  const attackerId = state.players[state.currentAttackerIndex].id;
  const defenderId = state.players[state.currentDefenderIndex].id;
  const discardCards: Card[] = [];
  for (const entry of state.table.attacks) {
    discardCards.push(entry.card);
    if (entry.beatenBy) discardCards.push(entry.beatenBy);
  }
  let next: GameState = {
    ...state,
    discard: [...state.discard, ...discardCards],
    table: { attacks: [] },
    passedPlayerIds: [],
  };
  const { state: refilled, event: drewEvent } = refillHands(next, attackerId, defenderId);
  next = refilled;

  const events: DomainEvent[] = [drewEvent];

  // Mark finished players (after refill).
  const { state: afterFinish, events: finishEvents } = markFinishedPlayers(next);
  next = afterFinish;
  events.push(...finishEvents);

  // Check for game over.
  const gameOver = checkGameOver(next);
  if (gameOver) {
    return { state: gameOver.state, events: [...events, ...gameOver.events] };
  }

  // Defender becomes attacker.
  const exDefenderIndex = next.players.findIndex((p) => p.id === defenderId);
  const newAttackerIndex = next.finishedPlayers.includes(defenderId)
    ? nextActivePlayerIndex(next, exDefenderIndex)
    : exDefenderIndex;
  const newDefenderIndex = nextActivePlayerIndex(next, newAttackerIndex);

  next = startNewBout(next, newAttackerIndex, newDefenderIndex);

  events.push({
    type: 'TurnPassed',
    newAttackerId: next.players[newAttackerIndex].id,
    newDefenderId: next.players[newDefenderIndex].id,
  });
  return { state: next, events };
}

/**
 * Finalises the current bout with a `taken` outcome:
 *   - all table cards (attacks + defences) go to the defender's hand,
 *   - refill (defender is skipped — they already grew),
 *   - rotate so attacker remains the SAME side (defender is skipped one
 *     round; next attacker is the player after the defender),
 *   - bump boutNumber.
 */
export function closeBoutTaken(state: GameState): {
  state: GameState;
  events: DomainEvent[];
} {
  const attackerId = state.players[state.currentAttackerIndex].id;
  const defenderId = state.players[state.currentDefenderIndex].id;
  const grabbed: Card[] = [];
  for (const entry of state.table.attacks) {
    grabbed.push(entry.card);
    if (entry.beatenBy) grabbed.push(entry.beatenBy);
  }
  let next: GameState = {
    ...state,
    players: state.players.map((p) =>
      p.id === defenderId ? { ...p, hand: [...p.hand, ...grabbed] } : p,
    ),
    table: { attacks: [] },
    passedPlayerIds: [],
  };

  const events: DomainEvent[] = [{ type: 'CardsTaken', defenderId, count: grabbed.length }];

  // Refill — defender does NOT draw this turn (standard rule).
  const { state: refilled, event: drewEvent } = refillHands(next, attackerId, defenderId, {
    skipPlayerId: defenderId,
  });
  next = refilled;
  events.push(drewEvent);

  // Mark finished players.
  const { state: afterFinish, events: finishEvents } = markFinishedPlayers(next);
  next = afterFinish;
  events.push(...finishEvents);

  const gameOver = checkGameOver(next);
  if (gameOver) {
    return { state: gameOver.state, events: [...events, ...gameOver.events] };
  }

  // Attacker is the player AFTER the defender (defender skipped this bout).
  const defenderIndex = next.players.findIndex((p) => p.id === defenderId);
  const newAttackerIndex = nextActivePlayerIndex(next, defenderIndex);
  const newDefenderIndex = nextActivePlayerIndex(next, newAttackerIndex);

  next = startNewBout(next, newAttackerIndex, newDefenderIndex);

  events.push({
    type: 'TurnPassed',
    newAttackerId: next.players[newAttackerIndex].id,
    newDefenderId: next.players[newDefenderIndex].id,
  });
  return { state: next, events };
}

/**
 * Internal: bump bout number, reset per-bout fields, set attacker/defender.
 */
function startNewBout(state: GameState, attackerIndex: number, defenderIndex: number): GameState {
  const defender = state.players[defenderIndex];
  const initialAttempts: Record<PlayerId, number> = {};
  if (state.settings.cheatingEnabled) {
    for (const p of state.players) {
      initialAttempts[p.id] = state.settings.cheatAttempts;
    }
  }
  return {
    ...state,
    currentAttackerIndex: attackerIndex,
    currentDefenderIndex: defenderIndex,
    boutNumber: state.boutNumber + 1,
    initialDefenderHandSize: defender.hand.length,
    passedPlayerIds: [],
    cheatAttemptsRemaining: initialAttempts,
    status: 'bout_attack',
  };
}

/**
 * Players who have an empty hand AFTER refill (i.e. when the deck is empty)
 * are marked finished. Returns events for each new finisher.
 */
export function markFinishedPlayers(state: GameState): {
  state: GameState;
  events: DomainEvent[];
} {
  if (state.deck.length > 0) return { state, events: [] };
  const events: DomainEvent[] = [];
  const finished = state.finishedPlayers.slice();
  for (const player of state.players) {
    if (finished.includes(player.id)) continue;
    if (player.hand.length === 0) {
      finished.push(player.id);
      events.push({
        type: 'PlayerOut',
        playerId: player.id,
        place: finished.length,
      });
    }
  }
  return { state: { ...state, finishedPlayers: finished }, events };
}

/**
 * Game ends when one or zero non-finished players remain. The single
 * remaining player (with cards) is the durak. If all finished simultaneously,
 * the loser is null (draw).
 */
export function checkGameOver(state: GameState): {
  state: GameState;
  events: DomainEvent[];
} | null {
  const active = state.players.filter((p) => !state.finishedPlayers.includes(p.id));
  if (active.length > 1) return null;

  const placements: Array<{ playerId: PlayerId; place: number }> = state.finishedPlayers.map(
    (id, idx) => ({ playerId: id, place: idx + 1 }),
  );
  let loserId: PlayerId | null = null;
  if (active.length === 1) {
    loserId = active[0].id;
    placements.push({ playerId: loserId, place: placements.length + 1 });
  }
  return {
    state: { ...state, status: 'game_over', loserPlayerId: loserId },
    events: [{ type: 'GameEnded', loserId, placements }],
  };
}
