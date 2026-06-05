/**
 * Top-level reducer: `applyCommand(state, command) => CommandResult`.
 *
 * Each command is a pure function over `GameState`. The reducer never
 * mutates the input; on failure it returns `{ ok: false, code, message }`
 * with no state change.
 */

import type {
  AttackEntry,
  Card,
  CommandFailure,
  CommandResult,
  DomainEvent,
  GameCommand,
  GameState,
  Player,
  PlayerId,
} from '../types.js';
import { beats, isStandard } from '../deck/card.js';
import { defaultBeatRule } from '../strategies/beat-rule.js';
import { attackPolicyFor } from '../strategies/attack-policy.js';
import { defaultTranslatePolicy } from '../strategies/translate-policy.js';
import { decrementCheatAttempts, defaultCheatPolicy } from '../strategies/cheat-policy.js';
import { defaultFirstBoutLimit } from '../strategies/first-bout-limit.js';
import {
  attacksRemaining,
  closeBoutBeaten,
  closeBoutTaken,
  tableFullyBeaten,
  tableHasUnbeaten,
} from './transitions.js';
import { nextActivePlayerIndex } from '../strategies/translate-policy.js';

function fail(code: CommandFailure['code'], message: string): CommandFailure {
  return { ok: false, code, message };
}

function findPlayer(state: GameState, id: PlayerId): Player | null {
  return state.players.find((p) => p.id === id) ?? null;
}

function removeCardFromHand(hand: readonly Card[], cardId: string): Card[] | null {
  const idx = hand.findIndex((c) => c.id === cardId);
  if (idx === -1) return null;
  return [...hand.slice(0, idx), ...hand.slice(idx + 1)];
}

function replacePlayer(state: GameState, playerId: PlayerId, update: Partial<Player>): GameState {
  return {
    ...state,
    players: state.players.map((p) => (p.id === playerId ? { ...p, ...update } : p)),
  };
}

function nextEntry(
  state: GameState,
  card: Card,
  attackerId: PlayerId,
): { entry: AttackEntry; nextId: number } {
  const id = `t${state.boutNumber}-${state.nextEntryId}`;
  return {
    entry: { id, card, beatenBy: null, attackerId },
    nextId: state.nextEntryId + 1,
  };
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

export function applyCommand(state: GameState, command: GameCommand): CommandResult {
  if (state.status === 'game_over') {
    return fail('GAME_OVER', 'Game is already finished');
  }
  switch (command.type) {
    case 'attack':
      return reduceAttack(state, command);
    case 'beat':
      return reduceBeat(state, command);
    case 'translate':
      return reduceTranslate(state, command);
    case 'take':
      return reduceTake(state, command);
    case 'pass':
      return reducePass(state, command);
    case 'notice_cheat':
      return reduceNoticeCheat(state, command);
    default: {
      const _exhaustive: never = command;
      void _exhaustive;
      return fail('INVALID_COMMAND', 'Unknown command');
    }
  }
}

// --------------------------------------------------------------------------
// Attack
// --------------------------------------------------------------------------

function reduceAttack(
  state: GameState,
  command: Extract<GameCommand, { type: 'attack' }>,
): CommandResult {
  const player = findPlayer(state, command.playerId);
  if (!player) return fail('INVALID_COMMAND', 'Unknown player');

  if (state.finishedPlayers.includes(player.id)) {
    return fail('NOT_YOUR_TURN', 'Finished players cannot act');
  }

  const policy = attackPolicyFor(state.settings.attackerScope);
  if (!policy.canThrow(state, player.id)) {
    return fail('NOT_YOUR_TURN', 'You may not throw cards right now');
  }
  if (
    state.status !== 'bout_attack' &&
    state.status !== 'bout_defense' &&
    state.status !== 'bout_settle' &&
    state.status !== 'bout_take_pending'
  ) {
    return fail('ATTACK_NOT_ALLOWED', 'Cannot attack in current phase');
  }
  // First card of the bout must be by the attacker.
  if (state.table.attacks.length === 0) {
    if (player.id !== state.players[state.currentAttackerIndex].id) {
      return fail('NOT_YOUR_TURN', 'Only the attacker may open a bout');
    }
  }

  const card = player.hand.find((c) => c.id === command.cardId);
  if (!card) return fail('CARD_NOT_IN_HAND', 'Card not in hand');

  // Rank rule for non-opening attacks: must match a rank already on the table
  // (attack OR beat). Only enforced when cheating is disabled — cheaters may
  // play anything and get caught via notice_cheat. Checked BEFORE the capacity
  // check so that callers get a specific error code for invalid cards even
  // when the bout is at capacity.
  if (state.table.attacks.length > 0 && !state.settings.cheatingEnabled) {
    if (!matchesAnyRankOnTable(state, card)) {
      return fail('CARD_RANK_NOT_ON_TABLE', 'Card does not match any rank on the table');
    }
  }
  // Capacity check.
  if (attacksRemaining(state) <= 0) {
    return fail('ATTACK_LIMIT_REACHED', 'No more attacks may be added this bout');
  }

  // Apply.
  const newHand = removeCardFromHand(player.hand, command.cardId);
  if (!newHand) return fail('CARD_NOT_IN_HAND', 'Card not in hand');

  const { entry, nextId } = nextEntry(state, card, player.id);
  let next: GameState = replacePlayer(state, player.id, { hand: newHand });
  // A new attack invalidates previous "pass" / "пусть берёт" votes — players
  // have to re-evaluate now that the situation changed.
  //
  // Status logic for throw-ins during `bout_take_pending`:
  //   - cheatingEnabled=true: revert to `bout_defense`. A throw-in might be a
  //     cheat (off-rank), and the defender must regain the ability to call
  //     `notice_cheat`, beat the new card, or re-press "Беру". Locking them
  //     into the take would force them to swallow the fake card.
  //   - cheatingEnabled=false: stay in `bout_take_pending`. Throw-ins are
  //     rank-validated up front, so there's no cheat to catch — the defender
  //     stays committed to taking.
  //
  // For every other phase the freshly added entry is unbeaten, so we
  // transition to `bout_defense`.
  const nextStatus: GameState['status'] =
    state.status === 'bout_take_pending' && !state.settings.cheatingEnabled
      ? 'bout_take_pending'
      : 'bout_defense';
  next = {
    ...next,
    table: { attacks: [...next.table.attacks, entry] },
    nextEntryId: nextId,
    passedPlayerIds: [],
    status: nextStatus,
  };

  const events: DomainEvent[] = [
    { type: 'CardAttacked', playerId: player.id, entryId: entry.id, card },
  ];

  // Auto-close `bout_take_pending` when no further throws are possible and
  // cheating is off (no rank-rule trickery is permitted). Mirrors the
  // auto-close inside reduceTake but covers the case where a throw-in just
  // saturated the cap.
  if (
    next.status === 'bout_take_pending' &&
    !next.settings.cheatingEnabled &&
    attacksRemaining(next) <= 0
  ) {
    const { state: closed, events: closeEvents } = closeBoutTaken(next);
    events.push({ type: 'BoutEnded', outcome: 'taken', boutNumber: state.boutNumber });
    events.push(...closeEvents);
    next = closed;
  }
  return { ok: true, state: next, events };
}

function matchesAnyRankOnTable(state: GameState, card: Card): boolean {
  if (!isStandard(card)) return true; // jokers always match
  for (const entry of state.table.attacks) {
    if (isStandard(entry.card) && entry.card.rank === card.rank) return true;
    if (entry.beatenBy && isStandard(entry.beatenBy) && entry.beatenBy.rank === card.rank) {
      return true;
    }
  }
  return false;
}

// --------------------------------------------------------------------------
// Beat
// --------------------------------------------------------------------------

function reduceBeat(
  state: GameState,
  command: Extract<GameCommand, { type: 'beat' }>,
): CommandResult {
  const defender = state.players[state.currentDefenderIndex];
  if (defender.id !== command.playerId) {
    return fail('NOT_YOUR_TURN', 'Only the defender may beat');
  }
  if (state.status !== 'bout_defense') {
    return fail('BEAT_NOT_ALLOWED', 'Nothing to beat');
  }
  const entry = state.table.attacks.find((a) => a.id === command.attackEntryId);
  if (!entry) return fail('ENTRY_NOT_FOUND', 'Attack entry not found');
  if (entry.beatenBy) return fail('ENTRY_ALREADY_BEATEN', 'This attack is already beaten');

  const card = defender.hand.find((c) => c.id === command.defenseCardId);
  if (!card) return fail('CARD_NOT_IN_HAND', 'Defense card not in hand');

  // Strict rule check only when cheating disabled.
  if (!state.settings.cheatingEnabled) {
    if (!defaultBeatRule.beats(card, entry.card, state.trumpSuit)) {
      return fail('CARD_DOES_NOT_BEAT', 'This card does not beat the attack');
    }
  }

  const newHand = removeCardFromHand(defender.hand, command.defenseCardId);
  if (!newHand) return fail('CARD_NOT_IN_HAND', 'Defense card not in hand');

  let next: GameState = replacePlayer(state, defender.id, { hand: newHand });
  next = {
    ...next,
    table: {
      attacks: next.table.attacks.map((a) => (a.id === entry.id ? { ...a, beatenBy: card } : a)),
    },
    passedPlayerIds: [],
  };
  const events: DomainEvent[] = [
    {
      type: 'CardBeaten',
      defenderId: defender.id,
      attackEntryId: entry.id,
      defenseCard: card,
    },
  ];
  // If everything is beaten, the bout is settled.
  //  - With cheating enabled we still need a settle phase so other players have
  //    a window to `notice_cheat` on the final beat before the bout is closed.
  //  - With cheating disabled there is no cheat to catch, so the bout closes
  //    automatically — no "Бито" button required from throwers.
  if (tableFullyBeaten(next)) {
    if (state.settings.cheatingEnabled) {
      next = { ...next, status: 'bout_settle' };
    } else {
      const { state: closed, events: closeEvents } = closeBoutBeaten(next);
      events.push({ type: 'BoutEnded', outcome: 'beaten', boutNumber: state.boutNumber });
      events.push(...closeEvents);
      next = closed;
    }
  }
  return { ok: true, state: next, events };
}

// --------------------------------------------------------------------------
// Translate
// --------------------------------------------------------------------------

function reduceTranslate(
  state: GameState,
  command: Extract<GameCommand, { type: 'translate' }>,
): CommandResult {
  const defender = state.players[state.currentDefenderIndex];
  if (defender.id !== command.playerId) {
    return fail('NOT_YOUR_TURN', 'Only the defender may translate');
  }
  // Once the defender has committed to taking, the translate window is gone.
  if (state.status === 'bout_take_pending') {
    return fail('TRANSLATE_NOT_ALLOWED', 'Defender is already taking — cannot translate');
  }
  const card = defender.hand.find((c) => c.id === command.cardId);
  if (!card) return fail('CARD_NOT_IN_HAND', 'Translate card not in hand');

  const check = defaultTranslatePolicy.canTranslate(state, defender.id, card);
  if (!check.ok) {
    return fail('TRANSLATE_NOT_ALLOWED', `Translate not allowed: ${check.reason}`);
  }
  // Translate has its own capacity rule (new defender's hand >= new attack
  // count), already enforced by `canTranslate`. Here we only apply the
  // per-bout hard cap (`firstBoutLimit`) — the current-defender-hand factor
  // in `attacksRemaining` is irrelevant since the current defender is
  // leaving the role.
  const cap = defaultFirstBoutLimit.limit(state);
  if (state.table.attacks.length + 1 > cap) {
    return fail('ATTACK_LIMIT_REACHED', 'Cap reached — cannot translate further');
  }

  const newHand = removeCardFromHand(defender.hand, command.cardId);
  if (!newHand) return fail('CARD_NOT_IN_HAND', 'Translate card not in hand');

  // The translation card is placed by the (current) defender, who in the same
  // step becomes the new attacker. Attribute the entry to that player.
  const { entry, nextId } = nextEntry(state, card, defender.id);
  let next: GameState = replacePlayer(state, defender.id, { hand: newHand });

  // Roles rotate: ex-defender becomes attacker, next player becomes defender.
  const newAttackerIndex = state.currentDefenderIndex;
  const newDefenderIndex = nextActivePlayerIndex(state, newAttackerIndex);

  // Reset the bout-cap reference to the NEW defender's current hand size.
  // attacksRemaining clamps to min(cap, initialDefenderHandSize), so without
  // this reset the throw-in cap could exceed what the new defender can
  // actually beat (e.g. translate to a player with 3 cards while the original
  // defender had 6 — without the reset the bout would allow up to 6 attacks).
  const newDefenderHandSize = next.players[newDefenderIndex].hand.length;

  next = {
    ...next,
    table: { attacks: [...next.table.attacks, entry] },
    nextEntryId: nextId,
    currentAttackerIndex: newAttackerIndex,
    currentDefenderIndex: newDefenderIndex,
    initialDefenderHandSize: newDefenderHandSize,
    passedPlayerIds: [],
    status: 'bout_defense',
  };

  const events: DomainEvent[] = [
    {
      type: 'CardTranslated',
      fromPlayerId: defender.id,
      newDefenderId: next.players[newDefenderIndex].id,
      card,
    },
  ];
  return { ok: true, state: next, events };
}

// --------------------------------------------------------------------------
// Take
// --------------------------------------------------------------------------

function reduceTake(
  state: GameState,
  command: Extract<GameCommand, { type: 'take' }>,
): CommandResult {
  const defender = state.players[state.currentDefenderIndex];
  if (defender.id !== command.playerId) {
    return fail('NOT_YOUR_TURN', 'Only the defender may take');
  }
  if (state.status !== 'bout_defense' && state.status !== 'bout_settle') {
    return fail('TAKE_NOT_ALLOWED', 'Nothing to take');
  }
  if (state.table.attacks.length === 0) {
    return fail('TAKE_NOT_ALLOWED', 'Table is empty');
  }

  // Standard Дурак rule: when the defender says "беру", the bout does NOT
  // end immediately. The throwers (attacker + supporters) get a final window
  // to pile on extra cards of ranks already on the table. Each must then say
  // "пусть берёт" (pass) — only when everyone has acknowledged do the cards
  // actually move to the defender's hand.
  //
  // We park the bout in `bout_take_pending` until either:
  //   - all eligible throwers have passed (handled in reducePass), or
  //   - no thrower can possibly add a card (auto-close, see below).
  let next: GameState = {
    ...state,
    // Fresh take wipes any prior "бито" votes — the situation has changed and
    // throwers must re-evaluate now that the defender has committed to taking.
    passedPlayerIds: [],
    status: 'bout_take_pending',
  };
  const events: DomainEvent[] = [{ type: 'DefenderTookCalled', defenderId: defender.id }];

  // Auto-close convenience: with cheating disabled, every throw-in must match
  // a rank already on the table. If the per-bout capacity is exhausted, no
  // throw can land regardless of hands, so we don't make the player click
  // "пусть берёт" — close the bout right away.
  if (!state.settings.cheatingEnabled && attacksRemaining(next) <= 0) {
    const { state: closed, events: closeEvents } = closeBoutTaken(next);
    events.push({ type: 'BoutEnded', outcome: 'taken', boutNumber: state.boutNumber });
    events.push(...closeEvents);
    next = closed;
  }

  return { ok: true, state: next, events };
}

// --------------------------------------------------------------------------
// Pass ("бито")
// --------------------------------------------------------------------------

function reducePass(
  state: GameState,
  command: Extract<GameCommand, { type: 'pass' }>,
): CommandResult {
  const player = findPlayer(state, command.playerId);
  if (!player) return fail('INVALID_COMMAND', 'Unknown player');
  if (state.finishedPlayers.includes(player.id)) {
    return fail('PASS_NOT_ALLOWED', 'Finished players cannot pass');
  }
  // `pass` is the "Бито" vote in `bout_settle` and the "Пусть берёт" vote in
  // `bout_take_pending`. Both share the same accumulator logic; only the
  // closure call differs at the end.
  if (state.status !== 'bout_settle' && state.status !== 'bout_take_pending') {
    return fail('PASS_NOT_ALLOWED', 'Cannot say "бито" right now');
  }
  // Defender is not a thrower; their "pass" is meaningless here.
  const policy = attackPolicyFor(state.settings.attackerScope);
  if (!policy.canThrow(state, player.id)) {
    return fail('PASS_NOT_ALLOWED', 'You are not allowed to throw cards anyway');
  }
  if (state.passedPlayerIds.includes(player.id)) {
    return fail('PASS_NOT_ALLOWED', 'Already passed');
  }

  const phase = state.status;
  let next: GameState = {
    ...state,
    passedPlayerIds: [...state.passedPlayerIds, player.id],
  };
  const events: DomainEvent[] = [{ type: 'TablePassed', sayerId: player.id }];

  // Did everyone who can still throw say pass?
  const eligible = state.players.filter(
    (p) =>
      !state.finishedPlayers.includes(p.id) &&
      p.id !== state.players[state.currentDefenderIndex].id &&
      policy.canThrow(state, p.id),
  );
  const allPassed = eligible.every((p) => next.passedPlayerIds.includes(p.id));
  if (allPassed) {
    if (phase === 'bout_settle') {
      const { state: closed, events: closeEvents } = closeBoutBeaten(next);
      events.push({ type: 'BoutEnded', outcome: 'beaten', boutNumber: state.boutNumber });
      events.push(...closeEvents);
      next = closed;
    } else {
      // bout_take_pending — defender takes everything on the table.
      const { state: closed, events: closeEvents } = closeBoutTaken(next);
      events.push({ type: 'BoutEnded', outcome: 'taken', boutNumber: state.boutNumber });
      events.push(...closeEvents);
      next = closed;
    }
  }
  return { ok: true, state: next, events };
}

// --------------------------------------------------------------------------
// Notice cheat
// --------------------------------------------------------------------------

function reduceNoticeCheat(
  state: GameState,
  command: Extract<GameCommand, { type: 'notice_cheat' }>,
): CommandResult {
  if (!state.settings.cheatingEnabled) {
    return fail('CHEAT_DISABLED', 'Cheating is disabled');
  }
  const noticer = findPlayer(state, command.playerId);
  if (!noticer) return fail('INVALID_COMMAND', 'Unknown player');

  const entry = state.table.attacks.find((a) => a.id === command.attackEntryId);
  if (!entry) return fail('ENTRY_NOT_FOUND', 'Attack entry not found');

  // Determine the cheat target: prefer to validate the most-recent action on
  // this entry. If a beat exists, check the beat; else check the attack
  // against the rank already on table.
  const isBeatBeingChecked = entry.beatenBy !== null;

  // Determine the cheater up front: for a beat-check it is the current
  // defender (whoever owns the beat); for an attack-check it is the player
  // who actually placed that attack entry — taken from the entry itself so
  // attribution survives translates.
  const cheaterId: PlayerId = isBeatBeingChecked
    ? state.players[state.currentDefenderIndex].id
    : findAttackerForEntry(state, entry.id);

  // Authorization (per-scope).
  if (!defaultCheatPolicy.canNotice(state, noticer.id, cheaterId, isBeatBeingChecked)) {
    return fail('NOT_YOUR_TURN', 'You are not allowed to notice cheating here');
  }

  let succeeded = false;

  if (isBeatBeingChecked) {
    // Validate the beat.
    const ok = entry.beatenBy ? beats(entry.beatenBy, entry.card, state.trumpSuit) : true;
    succeeded = !ok;
  } else {
    // Validate the attack rank against cards that were on the table BEFORE
    // this one was placed. The first attack of a bout is always legal (any
    // card may open). It's critical to use entries PRECEDING this one (not
    // every other entry on the table): a later, legitimate throw of the same
    // rank as a fake card must not retroactively launder the fake — e.g. if
    // an attacker illegally throws Q on a "3"-bout, then a third player
    // genuinely adds a 3, the Q itself stays illegal even though the table
    // now contains both Q-rank and 3-rank.
    const entryIndex = state.table.attacks.findIndex((a) => a.id === entry.id);
    if (entryIndex <= 0) {
      // Either not found (shouldn't happen — we just resolved it) or the
      // very first card of the bout, which opens the round and is always
      // legal.
      succeeded = false;
    } else {
      const card = entry.card;
      if (!isStandard(card)) {
        succeeded = false; // jokers always legal
      } else {
        const previousRanks = ranksBeforeIndex(state, entryIndex);
        succeeded = !previousRanks.has(card.rank);
      }
    }
  }

  const events: DomainEvent[] = [];
  let next: GameState = state;

  if (succeeded) {
    // Roll the cheat back: return the offending card to the cheater's hand.
    if (isBeatBeingChecked) {
      const defenderId = cheaterId;
      const card = entry.beatenBy as Card;
      next = replacePlayer(next, defenderId, {
        hand: [...(findPlayer(next, defenderId)?.hand ?? []), card],
      });
      next = {
        ...next,
        table: {
          attacks: next.table.attacks.map((a) =>
            a.id === entry.id ? { ...a, beatenBy: null } : a,
          ),
        },
      };
    } else {
      // Return the attack card to the attacker who placed it.
      next = replacePlayer(next, cheaterId, {
        hand: [...(findPlayer(next, cheaterId)?.hand ?? []), entry.card],
      });
      next = {
        ...next,
        table: { attacks: next.table.attacks.filter((a) => a.id !== entry.id) },
      };
    }

    // Recompute the bout phase from the resulting table layout:
    //   - no attacks left  -> attacker opens again (bout_attack)
    //   - some unbeaten    -> defender owes a beat   (bout_defense)
    //   - all beaten       -> wait for "пас"-es      (bout_settle)
    //
    // Exception: if the defender already said "беру" we stay in
    // `bout_take_pending` — undoing a single cheat does not retract their
    // decision to take.
    let nextStatus: GameState['status'];
    if (state.status === 'bout_take_pending' && next.table.attacks.length > 0) {
      nextStatus = 'bout_take_pending';
    } else if (next.table.attacks.length === 0) {
      nextStatus = 'bout_attack';
    } else if (tableHasUnbeaten(next)) {
      nextStatus = 'bout_defense';
    } else {
      nextStatus = 'bout_settle';
    }
    next = { ...next, status: nextStatus };

    // Successful catch consumes one of the CHEATER's per-bout attempts (the
    // noticer's pool is untouched — being right is free).
    next = {
      ...next,
      cheatAttemptsRemaining: decrementCheatAttempts(
        next.cheatAttemptsRemaining,
        cheaterId,
        next.settings.cheatAttempts,
      ),
    };
  }
  // Unsuccessful notice has no effect — the accusation was unfounded and
  // neither player's attempt counter moves.

  events.push({
    type: 'CheatNoticed',
    noticerId: noticer.id,
    cheaterId,
    attackEntryId: entry.id,
    succeeded,
  });

  return { ok: true, state: next, events };
}

/**
 * Returns the set of ranks visible on the table BEFORE the entry at the given
 * array index was placed. Used by cheat-notice validation so a later legitimate
 * throw of the same rank cannot retroactively launder an earlier fake card.
 * Jokers contribute no rank.
 */
function ranksBeforeIndex(state: GameState, entryIndex: number): Set<number> {
  const ranks = new Set<number>();
  for (let i = 0; i < entryIndex; i++) {
    const entry = state.table.attacks[i];
    if (isStandard(entry.card)) ranks.add(entry.card.rank);
    // A beat played before this entry was added would also be on the table at
    // throw-time, but beats are only legal once their attack has been placed,
    // so any earlier-indexed entry's beat happened strictly before this entry.
    if (entry.beatenBy && isStandard(entry.beatenBy)) ranks.add(entry.beatenBy.rank);
  }
  return ranks;
}

/**
 * Returns the id of the player who actually placed the given attack entry.
 * The id is stored on the entry at creation time, so translates (which
 * rotate roles but leave previous entries on the table) don't break
 * cheat-notice attribution.
 *
 * Falls back to the current attacker if the entry has somehow lost its
 * `attackerId` (older replays / hand-crafted fixtures).
 */
function findAttackerForEntry(state: GameState, entryId: string): PlayerId {
  const entry = state.table.attacks.find((a) => a.id === entryId);
  if (entry?.attackerId) return entry.attackerId;
  return state.players[state.currentAttackerIndex].id;
}
