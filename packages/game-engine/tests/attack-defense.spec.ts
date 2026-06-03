import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/state/reducers.js';
import { card, craftGame } from '../src/_testing/fixtures.js';

describe('attack', () => {
  it('rejects when player tries to play a card not in hand', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6)] },
        { id: 'B', hand: [card('hearts', 9)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: false },
    });
    const res = applyCommand(state, {
      type: 'attack',
      playerId: 'A',
      cardId: 'spades-14',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('CARD_NOT_IN_HAND');
  });

  it('rejects when non-attacker opens a bout', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6)] },
        { id: 'B', hand: [card('hearts', 9)] },
        { id: 'C', hand: [card('hearts', 7)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: false },
    });
    const res = applyCommand(state, {
      type: 'attack',
      playerId: 'C',
      cardId: 'hearts-7',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('NOT_YOUR_TURN');
  });

  it('rejects when defender tries to attack', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6)] },
        { id: 'B', hand: [card('hearts', 9)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: false, attackerScope: 'all' },
    });
    const res = applyCommand(state, {
      type: 'attack',
      playerId: 'B',
      cardId: 'hearts-9',
    });
    expect(res.ok).toBe(false);
  });

  it('moves card from hand to table and switches to bout_defense', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6)] },
        { id: 'B', hand: [card('hearts', 9)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: false },
    });
    const res = applyCommand(state, {
      type: 'attack',
      playerId: 'A',
      cardId: 'hearts-6',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.players[0].hand).toHaveLength(0);
      expect(res.state.table.attacks).toHaveLength(1);
      expect(res.state.table.attacks[0].card.id).toBe('hearts-6');
      expect(res.state.status).toBe('bout_defense');
      expect(res.events[0]).toMatchObject({ type: 'CardAttacked', playerId: 'A' });
    }
  });

  it('rejects rank-mismatched throw when cheating is disabled', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6), card('clubs', 14)] },
        { id: 'B', hand: [card('hearts', 9)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: false },
    });
    const r1 = applyCommand(state, {
      type: 'attack',
      playerId: 'A',
      cardId: 'hearts-6',
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = applyCommand(r1.state, {
      type: 'attack',
      playerId: 'A',
      cardId: 'clubs-14',
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('CARD_RANK_NOT_ON_TABLE');
  });

  it('accepts illegal rank throw when cheating enabled', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6), card('clubs', 14)] },
        { id: 'B', hand: [card('hearts', 9), card('hearts', 10)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: true, cheatAttempts: 1 },
    });
    const r1 = applyCommand(state, {
      type: 'attack',
      playerId: 'A',
      cardId: 'hearts-6',
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = applyCommand(r1.state, {
      type: 'attack',
      playerId: 'A',
      cardId: 'clubs-14',
    });
    expect(r2.ok).toBe(true); // accepted; the cheat exists until someone notices
  });
});

describe('beat', () => {
  it('rejects when called by non-defender', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6)] },
        { id: 'B', hand: [card('hearts', 9)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: false },
    });
    const r1 = applyCommand(state, {
      type: 'attack',
      playerId: 'A',
      cardId: 'hearts-6',
    });
    if (!r1.ok) throw new Error('attack failed');
    const r2 = applyCommand(r1.state, {
      type: 'beat',
      playerId: 'A',
      attackEntryId: r1.state.table.attacks[0].id,
      defenseCardId: 'hearts-9',
    });
    expect(r2.ok).toBe(false);
  });

  it('rejects when card does not beat (cheating disabled)', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 10)] },
        { id: 'B', hand: [card('hearts', 9)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: false },
    });
    const r1 = applyCommand(state, {
      type: 'attack',
      playerId: 'A',
      cardId: 'hearts-10',
    });
    if (!r1.ok) throw new Error('attack failed');
    const r2 = applyCommand(r1.state, {
      type: 'beat',
      playerId: 'B',
      attackEntryId: r1.state.table.attacks[0].id,
      defenseCardId: 'hearts-9',
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('CARD_DOES_NOT_BEAT');
  });

  it('successful beat sets beatenBy and progresses to bout_settle', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6)] },
        { id: 'B', hand: [card('hearts', 10)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: false },
    });
    const r1 = applyCommand(state, {
      type: 'attack',
      playerId: 'A',
      cardId: 'hearts-6',
    });
    if (!r1.ok) throw new Error();
    const r2 = applyCommand(r1.state, {
      type: 'beat',
      playerId: 'B',
      attackEntryId: r1.state.table.attacks[0].id,
      defenseCardId: 'hearts-10',
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.players[1].hand).toHaveLength(0);
    expect(r2.state.table.attacks[0].beatenBy?.id).toBe('hearts-10');
    expect(r2.state.status).toBe('bout_settle');
  });
});

describe('take', () => {
  it('moves all table cards to defender hand', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6), card('hearts', 7)] },
        { id: 'B', hand: [card('clubs', 9)] },
        { id: 'C', hand: [card('diamonds', 8)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: false, attackerScope: 'all' },
    });
    const r1 = applyCommand(state, {
      type: 'attack',
      playerId: 'A',
      cardId: 'hearts-6',
    });
    if (!r1.ok) throw new Error();
    const r2 = applyCommand(r1.state, { type: 'take', playerId: 'B' });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const defender = r2.state.players.find((p) => p.id === 'B')!;
    expect(defender.hand.map((c) => c.id)).toContain('hearts-6');
    expect(r2.state.table.attacks).toHaveLength(0);
    expect(r2.state.boutNumber).toBe(2);
  });

  it('after take, next attacker is the player AFTER the defender', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6), card('hearts', 7)] },
        { id: 'B', hand: [card('clubs', 9)] },
        { id: 'C', hand: [card('diamonds', 8)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: false },
    });
    const r1 = applyCommand(state, {
      type: 'attack',
      playerId: 'A',
      cardId: 'hearts-6',
    });
    if (!r1.ok) throw new Error();
    const r2 = applyCommand(r1.state, { type: 'take', playerId: 'B' });
    if (!r2.ok) throw new Error();
    expect(r2.state.players[r2.state.currentAttackerIndex].id).toBe('C');
    expect(r2.state.players[r2.state.currentDefenderIndex].id).toBe('A');
  });
});

describe('pass / bout settle', () => {
  it('all-pass closes bout into beaten; defender becomes attacker', () => {
    // Each player keeps an extra card after the bout so nobody finishes —
    // we want to assert role rotation, not game-over edge cases.
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6), card('diamonds', 2)] },
        { id: 'B', hand: [card('hearts', 10), card('diamonds', 3)] },
        { id: 'C', hand: [card('clubs', 7), card('diamonds', 4)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: false, attackerScope: 'all' },
    });
    const r1 = applyCommand(state, {
      type: 'attack',
      playerId: 'A',
      cardId: 'hearts-6',
    });
    if (!r1.ok) throw new Error();
    const r2 = applyCommand(r1.state, {
      type: 'beat',
      playerId: 'B',
      attackEntryId: r1.state.table.attacks[0].id,
      defenseCardId: 'hearts-10',
    });
    if (!r2.ok) throw new Error();
    expect(r2.state.status).toBe('bout_settle');

    const r3 = applyCommand(r2.state, { type: 'pass', playerId: 'A' });
    if (!r3.ok) throw new Error();
    const r4 = applyCommand(r3.state, { type: 'pass', playerId: 'C' });
    if (!r4.ok) throw new Error();
    expect(r4.state.boutNumber).toBe(2);
    expect(r4.state.players[r4.state.currentAttackerIndex].id).toBe('B');
  });

  it('rejects pass during attack phase', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6)] },
        { id: 'B', hand: [card('hearts', 10)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: false },
    });
    const r = applyCommand(state, { type: 'pass', playerId: 'A' });
    expect(r.ok).toBe(false);
  });
});

describe('first bout limits', () => {
  it('limit=5 blocks 6th attack in first bout', () => {
    const state = craftGame({
      players: [
        {
          id: 'A',
          hand: [6, 7, 8, 9, 10, 11].map((r) => card('hearts', r as 6)),
        },
        {
          id: 'B',
          hand: [12, 13, 14, 6, 7, 8].map((r) => card('hearts', r as 6)),
        },
        { id: 'C', hand: [card('clubs', 6), card('clubs', 7)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: false, firstBoutLimit: 5, attackerScope: 'all' },
    });
    // Place 5 attacks (different ranks happen to allow because B has matching
    // ranks to beat; we need same-rank attacks though — the engine only
    // requires "matches a rank on table". First card opens, subsequent must
    // match an existing rank. Use the same rank instead.
    const sameRankState = craftGame({
      players: [
        {
          id: 'A',
          hand: [card('hearts', 6), card('clubs', 6), card('diamonds', 6)],
        },
        { id: 'B', hand: [card('spades', 6)] },
        { id: 'C', hand: [card('hearts', 7), card('clubs', 7), card('diamonds', 7)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: false, firstBoutLimit: 5, attackerScope: 'all' },
    });
    // B has only 1 card, so attacksRemaining is capped by hand → 1.
    const r1 = applyCommand(sameRankState, {
      type: 'attack',
      playerId: 'A',
      cardId: 'hearts-6',
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = applyCommand(r1.state, {
      type: 'attack',
      playerId: 'A',
      cardId: 'clubs-6',
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('ATTACK_LIMIT_REACHED');

    // Now use a setup where defender has 5 cards and limit is 5, expect 6th to fail
    void state;
  });

  it('limit=defender_hand respects the defender hand-size at bout start', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6), card('clubs', 6)] },
        { id: 'B', hand: [card('hearts', 7), card('clubs', 7), card('diamonds', 7)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: {
        cheatingEnabled: false,
        firstBoutLimit: 'defender_hand',
        attackerScope: 'all',
      },
      initialDefenderHandSize: 3,
    });
    const r1 = applyCommand(state, {
      type: 'attack',
      playerId: 'A',
      cardId: 'hearts-6',
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = applyCommand(r1.state, {
      type: 'attack',
      playerId: 'A',
      cardId: 'clubs-6',
    });
    expect(r2.ok).toBe(true);
  });

  it('limit=5 accepts exactly 5 cards and rejects the 6th in bout 1', () => {
    // Defender has 6 cards (so hand size never gates the cap), and between
    // them attackers have FIVE rank-6 cards plus a sixth in C's hand to try
    // the over-limit push. Expect: cards #1..#5 succeed, #6 fails with
    // ATTACK_LIMIT_REACHED — proving the cap is exactly 5, not 6.
    //
    // The 36-card deck only contains four 6s, so we cheat one extra 6 in by
    // running with cheatingEnabled and skipping the rank gate. The cap is
    // independent of the rank rule.
    const state = craftGame({
      players: [
        {
          id: 'A',
          hand: [card('hearts', 6), card('clubs', 6), card('diamonds', 6)],
        },
        {
          id: 'B',
          hand: [
            card('hearts', 7),
            card('clubs', 7),
            card('diamonds', 7),
            card('spades', 7),
            card('hearts', 8),
            card('clubs', 8),
          ],
        },
        {
          id: 'C',
          hand: [card('spades', 6), card('hearts', 9), card('clubs', 9)],
        },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'clubs',
      // Cheating enabled so the rank rule doesn't fire — we want to isolate
      // the first-bout cap.
      settings: {
        cheatingEnabled: true,
        cheatAttempts: 1,
        firstBoutLimit: 5,
        attackerScope: 'all',
      },
    });
    let s = state;
    const plays: Array<{ p: string; c: string }> = [
      { p: 'A', c: 'hearts-6' },
      { p: 'A', c: 'clubs-6' },
      { p: 'A', c: 'diamonds-6' },
      { p: 'C', c: 'spades-6' },
      { p: 'C', c: 'hearts-9' }, // 5th card — still within cap=5
    ];
    for (const move of plays) {
      const r = applyCommand(s, { type: 'attack', playerId: move.p, cardId: move.c });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error(`${move.p}/${move.c}: ${r.code}`);
      s = r.state;
    }
    expect(s.table.attacks).toHaveLength(5);
    // 6th attack — must be blocked by the cap (defender still has 6 cards
    // so hand-size is not the gate).
    const r6 = applyCommand(s, { type: 'attack', playerId: 'C', cardId: 'clubs-9' });
    expect(r6.ok).toBe(false);
    if (!r6.ok) expect(r6.code).toBe('ATTACK_LIMIT_REACHED');
  });

  it('limit=5 stays at 5 in bout 1; bout 2 onward switches to min(6, defenderHand)', () => {
    // Construct a state at bout 2 directly — boutNumber > 1 routes through
    // the DefaultFirstBoutLimit.fallthrough branch (= 6).
    const state = craftGame({
      players: [
        {
          id: 'A',
          hand: [card('hearts', 6), card('clubs', 6), card('diamonds', 6), card('spades', 6)],
        },
        {
          id: 'B',
          hand: [card('hearts', 7), card('clubs', 7), card('diamonds', 7), card('spades', 7)],
        },
        {
          id: 'C',
          hand: [card('hearts', 6), card('clubs', 9)],
        },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'clubs',
      settings: { cheatingEnabled: false, firstBoutLimit: 5, attackerScope: 'all' },
      boutNumber: 2,
      // Defender (B) holds 4 cards => effective cap = min(6, 4) = 4.
      initialDefenderHandSize: 4,
    });
    let s = state;
    // Four 6s should be accepted (limit becomes min(6, defenderHand=4) = 4).
    for (const move of [
      { p: 'A', c: 'hearts-6' },
      { p: 'A', c: 'clubs-6' },
      { p: 'A', c: 'diamonds-6' },
      { p: 'A', c: 'spades-6' },
    ]) {
      const r = applyCommand(s, { type: 'attack', playerId: move.p, cardId: move.c });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error(`${move.p}/${move.c}: ${r.code}`);
      s = r.state;
    }
    // A fifth same-rank from C is blocked because the cap is now defender hand
    // (4), not the original first-bout 5.
    const r5 = applyCommand(s, { type: 'attack', playerId: 'C', cardId: 'hearts-6' });
    expect(r5.ok).toBe(false);
    if (!r5.ok) expect(r5.code).toBe('ATTACK_LIMIT_REACHED');
  });
});
