/**
 * Tests for the `exclusiveThrowIn` setting — when true, only the primary
 * attacker may throw extra cards until they say "бито". After that the
 * throw-in opens to the rest per the underlying `attackerScope` rule.
 *
 * Translate edge case: the new primary attacker (ex-defender) takes over
 * the exclusivity slot; the old primary loses it. Translate already resets
 * `passedPlayerIds`, so the lock re-engages cleanly.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/state/reducers.js';
import { ExclusiveThrowInPolicy, AllPlayersPolicy } from '../src/strategies/attack-policy.js';
import { card, craftGame } from '../src/_testing/fixtures.js';

describe('exclusiveThrowIn: throw-in lock', () => {
  it('blocks a non-primary attacker from throwing while primary has not pasted', () => {
    // A is primary attacker, B is defender, C is a third potential thrower.
    // A throws first (bout_defense); C tries to pile in immediately → reject.
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 7), card('clubs', 9)] },
        {
          id: 'B',
          hand: [
            card('hearts', 11),
            card('hearts', 12),
            card('hearts', 13),
            card('hearts', 14),
          ],
        },
        { id: 'C', hand: [card('spades', 7), card('clubs', 10)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'diamonds',
      settings: {
        cheatingEnabled: false,
        attackerScope: 'all',
        exclusiveThrowIn: true,
      },
    });
    // A opens the bout.
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-7' });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    // We're in `bout_defense`. C tries to throw their own 7 — primary (A)
    // has not pasted, so the lock should reject.
    const r2 = applyCommand(r1.state, {
      type: 'attack',
      playerId: 'C',
      cardId: 'spades-7',
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('EXCLUSIVE_ATTACKER_NOT_DONE');
  });

  it('lets the primary attacker themselves throw freely', () => {
    // Use cheating-enabled mode so the bout stays in `bout_settle` after the
    // beat (cheating-off auto-closes the bout). Then verify A can pile in
    // another 7 of their own.
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 7), card('clubs', 7)] },
        {
          id: 'B',
          hand: [
            card('hearts', 11),
            card('hearts', 12),
            card('hearts', 13),
            card('hearts', 14),
          ],
        },
        { id: 'C', hand: [card('spades', 9)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'diamonds',
      settings: {
        cheatingEnabled: true,
        cheatAttempts: 1,
        attackerScope: 'all',
        exclusiveThrowIn: true,
      },
    });
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-7' });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = applyCommand(r1.state, {
      type: 'beat',
      playerId: 'B',
      attackEntryId: r1.state.table.attacks[0].id,
      defenseCardId: 'hearts-11',
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.status).toBe('bout_settle');
    // A piles in with their second 7 — allowed (they're the primary).
    const r3 = applyCommand(r2.state, {
      type: 'attack',
      playerId: 'A',
      cardId: 'clubs-7',
    });
    expect(r3.ok).toBe(true);
  });

  it('opens throw-in to others after the primary attacker says "бито"', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 7), card('clubs', 9)] },
        {
          id: 'B',
          hand: [
            card('hearts', 11),
            card('hearts', 12),
            card('hearts', 13),
            card('hearts', 14),
          ],
        },
        { id: 'C', hand: [card('spades', 7), card('clubs', 10)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'diamonds',
      settings: {
        cheatingEnabled: false,
        attackerScope: 'all',
        exclusiveThrowIn: true,
      },
    });
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-7' });
    if (!r1.ok) throw new Error(`r1: ${r1.code}`);
    const r2 = applyCommand(r1.state, {
      type: 'beat',
      playerId: 'B',
      attackEntryId: r1.state.table.attacks[0].id,
      defenseCardId: 'hearts-11',
    });
    if (!r2.ok) throw new Error(`r2: ${r2.code}`);
    // Now we're in bout_settle (cheating is off — but actually with cheating
    // disabled the bout closes automatically). Use cheating enabled instead
    // so we transition into bout_settle and primary can pass before bout closes.
    const state2 = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 7), card('clubs', 9)] },
        {
          id: 'B',
          hand: [
            card('hearts', 11),
            card('hearts', 12),
            card('hearts', 13),
            card('hearts', 14),
          ],
        },
        { id: 'C', hand: [card('spades', 7), card('clubs', 10)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'diamonds',
      settings: {
        cheatingEnabled: true,
        cheatAttempts: 1,
        attackerScope: 'all',
        exclusiveThrowIn: true,
      },
    });
    const s1 = applyCommand(state2, { type: 'attack', playerId: 'A', cardId: 'hearts-7' });
    if (!s1.ok) throw new Error(`s1: ${s1.code}`);
    const s2 = applyCommand(s1.state, {
      type: 'beat',
      playerId: 'B',
      attackEntryId: s1.state.table.attacks[0].id,
      defenseCardId: 'hearts-11',
    });
    if (!s2.ok) throw new Error(`s2: ${s2.code}`);
    expect(s2.state.status).toBe('bout_settle');
    // Before A pastes, C can't throw.
    const blocked = applyCommand(s2.state, {
      type: 'attack',
      playerId: 'C',
      cardId: 'spades-7',
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe('EXCLUSIVE_ATTACKER_NOT_DONE');
    // A says "бито" → lock releases.
    const s3 = applyCommand(s2.state, { type: 'pass', playerId: 'A' });
    if (!s3.ok) throw new Error(`s3: ${s3.code}`);
    // Bout should NOT have closed yet — C is still eligible.
    expect(s3.state.status).toBe('bout_settle');
    expect(s3.state.passedPlayerIds).toContain('A');
    // Now C may pile in.
    const s4 = applyCommand(s3.state, {
      type: 'attack',
      playerId: 'C',
      cardId: 'spades-7',
    });
    expect(s4.ok).toBe(true);
    void r2;
  });

  it('still allows the bout to close after every eligible thrower pastes', () => {
    // A throws, B beats, A pastes, C pastes → bout closes (cheating on path).
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 7), card('clubs', 9)] },
        {
          id: 'B',
          hand: [
            card('hearts', 11),
            card('hearts', 12),
            card('hearts', 13),
            card('hearts', 14),
          ],
        },
        { id: 'C', hand: [card('clubs', 10)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'diamonds',
      deck: Array.from({ length: 18 }, (_, i) =>
        card('diamonds', ((6 + (i % 9)) as 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14)),
      ),
      settings: {
        cheatingEnabled: true,
        cheatAttempts: 1,
        attackerScope: 'all',
        exclusiveThrowIn: true,
      },
    });
    const s1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-7' });
    if (!s1.ok) throw new Error(`s1: ${s1.code}`);
    const s2 = applyCommand(s1.state, {
      type: 'beat',
      playerId: 'B',
      attackEntryId: s1.state.table.attacks[0].id,
      defenseCardId: 'hearts-11',
    });
    if (!s2.ok) throw new Error(`s2: ${s2.code}`);
    expect(s2.state.status).toBe('bout_settle');
    const s3 = applyCommand(s2.state, { type: 'pass', playerId: 'A' });
    if (!s3.ok) throw new Error(`s3: ${s3.code}`);
    expect(s3.state.status).toBe('bout_settle');
    const s4 = applyCommand(s3.state, { type: 'pass', playerId: 'C' });
    if (!s4.ok) throw new Error(`s4: ${s4.code}`);
    // Bout closed; engine rotated to next bout.
    expect(s4.state.boutNumber).toBe(2);
  });
});

describe('exclusiveThrowIn: translate resets exclusivity', () => {
  it('after translate the new primary attacker holds the lock; old primary cannot throw', () => {
    // A attacks 7H. B translates with 7D → B becomes attacker, C becomes
    // defender. Now D (the next seat) is a potential thrower; A is also a
    // potential thrower (originally primary but now just a regular seat).
    // With exclusiveThrowIn=true, neither D nor A may throw until B pastes.
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 7), card('spades', 7)] },
        { id: 'B', hand: [card('diamonds', 7), card('clubs', 9)] },
        {
          id: 'C',
          hand: [
            card('clubs', 10),
            card('clubs', 11),
            card('clubs', 12),
            card('clubs', 13),
          ],
        },
        { id: 'D', hand: [card('hearts', 8), card('clubs', 7)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: {
        cheatingEnabled: false,
        attackerScope: 'all',
        exclusiveThrowIn: true,
      },
    });
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-7' });
    if (!r1.ok) throw new Error(`r1: ${r1.code}`);
    // B translates → B is new primary attacker, C is new defender.
    const r2 = applyCommand(r1.state, {
      type: 'translate',
      playerId: 'B',
      cardId: 'diamonds-7',
    });
    if (!r2.ok) throw new Error(`r2: ${r2.code}`);
    expect(r2.state.players[r2.state.currentAttackerIndex].id).toBe('B');
    expect(r2.state.players[r2.state.currentDefenderIndex].id).toBe('C');
    // passedPlayerIds was reset on translate.
    expect(r2.state.passedPlayerIds).toEqual([]);

    // A (the OLD primary) tries to throw → blocked by exclusive lock.
    const blockedA = applyCommand(r2.state, {
      type: 'attack',
      playerId: 'A',
      cardId: 'spades-7',
    });
    expect(blockedA.ok).toBe(false);
    if (!blockedA.ok) expect(blockedA.code).toBe('EXCLUSIVE_ATTACKER_NOT_DONE');

    // D tries to throw → also blocked (not primary).
    const blockedD = applyCommand(r2.state, {
      type: 'attack',
      playerId: 'D',
      cardId: 'clubs-7',
    });
    expect(blockedD.ok).toBe(false);
    if (!blockedD.ok) expect(blockedD.code).toBe('EXCLUSIVE_ATTACKER_NOT_DONE');

    // B (the NEW primary) throws their own 9? Wait — must match rank 7.
    // B doesn't have another 7, so we just verify the role is correct via
    // the lock check above. The "new primary can throw" path is covered in
    // the next test with hands rigged so B has a matching card.
  });

  it('after translate the new primary attacker CAN throw a matching card', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 7), card('spades', 8)] },
        { id: 'B', hand: [card('diamonds', 7), card('spades', 7)] },
        {
          id: 'C',
          hand: [
            card('clubs', 10),
            card('clubs', 11),
            card('clubs', 12),
            card('clubs', 13),
          ],
        },
        { id: 'D', hand: [card('hearts', 8)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'hearts',
      settings: {
        cheatingEnabled: false,
        attackerScope: 'all',
        exclusiveThrowIn: true,
      },
    });
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-7' });
    if (!r1.ok) throw new Error();
    const r2 = applyCommand(r1.state, {
      type: 'translate',
      playerId: 'B',
      cardId: 'diamonds-7',
    });
    if (!r2.ok) throw new Error(`r2: ${r2.code}`);
    // B (new primary) throws their second 7.
    const r3 = applyCommand(r2.state, {
      type: 'attack',
      playerId: 'B',
      cardId: 'spades-7',
    });
    expect(r3.ok).toBe(true);
  });
});

describe('exclusiveThrowIn: regression (default off)', () => {
  it('default behavior — non-primary player can pile in before primary pastes', () => {
    // Same setup as the lock test but with exclusiveThrowIn left at default
    // (false). C should be free to throw their own 7 right after A opens.
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 7), card('clubs', 9)] },
        {
          id: 'B',
          hand: [
            card('hearts', 11),
            card('hearts', 12),
            card('hearts', 13),
            card('hearts', 14),
          ],
        },
        { id: 'C', hand: [card('spades', 7), card('clubs', 10)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'diamonds',
      // exclusiveThrowIn not set → defaults to false via makeSettings.
      settings: { cheatingEnabled: false, attackerScope: 'all' },
    });
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-7' });
    if (!r1.ok) throw new Error();
    // C piles on a matching rank-7 immediately (no beat yet, table is still
    // in `bout_defense`). Legacy behavior allows this.
    const r2 = applyCommand(r1.state, {
      type: 'attack',
      playerId: 'C',
      cardId: 'spades-7',
    });
    expect(r2.ok).toBe(true);
  });
});

describe('ExclusiveThrowInPolicy: direct unit tests', () => {
  it('returns EXCLUSIVE_LOCK for non-primary when primary has not pasted', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 7)] },
        { id: 'B', hand: [card('hearts', 8)] },
        { id: 'C', hand: [card('spades', 7)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'diamonds',
      settings: { exclusiveThrowIn: true, attackerScope: 'all' },
    });
    const policy = new ExclusiveThrowInPolicy(new AllPlayersPolicy());
    const check = policy.checkThrow(state, 'C');
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe('EXCLUSIVE_LOCK');
  });

  it('releases the lock when primary has empty hand', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [] },
        { id: 'B', hand: [card('hearts', 8)] },
        { id: 'C', hand: [card('spades', 7)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'diamonds',
      settings: { exclusiveThrowIn: true, attackerScope: 'all' },
    });
    const policy = new ExclusiveThrowInPolicy(new AllPlayersPolicy());
    const check = policy.checkThrow(state, 'C');
    expect(check.ok).toBe(true);
  });

  it('releases the lock when primary is finished', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 7)] },
        { id: 'B', hand: [card('hearts', 8)] },
        { id: 'C', hand: [card('spades', 7)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'diamonds',
      settings: { exclusiveThrowIn: true, attackerScope: 'all' },
    });
    const withFinished = { ...state, finishedPlayers: ['A'] };
    const policy = new ExclusiveThrowInPolicy(new AllPlayersPolicy());
    const check = policy.checkThrow(withFinished, 'C');
    expect(check.ok).toBe(true);
  });
});
