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

  it('successful beat sets beatenBy and progresses to bout_settle (cheating enabled)', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6)] },
        { id: 'B', hand: [card('hearts', 10)] },
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

  it('auto-closes bout when cheating is disabled and defender beats the last card', () => {
    // Both players keep an extra card so nobody is finished after the
    // auto-close — we want to observe rotation, not game-over edge cases.
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6), card('diamonds', 2)] },
        { id: 'B', hand: [card('hearts', 10), card('clubs', 7)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'clubs',
      settings: { cheatingEnabled: false },
    });
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
    if (!r1.ok) throw new Error();
    const r2 = applyCommand(r1.state, {
      type: 'beat',
      playerId: 'B',
      attackEntryId: r1.state.table.attacks[0].id,
      defenseCardId: 'hearts-10',
    });
    if (!r2.ok) throw new Error();
    // Bout auto-closed: status moves on, table is empty, B becomes new attacker.
    expect(r2.state.status).not.toBe('bout_settle');
    expect(r2.state.table.attacks).toHaveLength(0);
    expect(r2.state.boutNumber).toBe(2);
    expect(r2.state.players[r2.state.currentAttackerIndex].id).toBe('B');
    // BoutEnded event was emitted.
    expect(r2.events.some((e) => e.type === 'BoutEnded')).toBe(true);
  });

  it('keeps bout_settle when cheating is enabled and defender beats the last card', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6)] },
        { id: 'B', hand: [card('hearts', 10)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'clubs',
      settings: { cheatingEnabled: true, cheatAttempts: 1 },
    });
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
    if (!r1.ok) throw new Error();
    const r2 = applyCommand(r1.state, {
      type: 'beat',
      playerId: 'B',
      attackEntryId: r1.state.table.attacks[0].id,
      defenseCardId: 'hearts-10',
    });
    if (!r2.ok) throw new Error();
    expect(r2.state.status).toBe('bout_settle');
  });

  it('throw-in during bout_settle reverts status back to bout_defense', () => {
    // Regression: after the bout was fully beaten (status='bout_settle'),
    // a throw-in from another player with a matching rank must put the bout
    // back into bout_defense so the defender can actually respond to it.
    // Previously the status calculation looked at the OLD table snapshot,
    // missed the freshly added unbeaten attack, and kept status='bout_settle'
    // — which left the table claiming all attacks beaten while a fresh card
    // sat there waiting for a beat.
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6), card('spades', 6)] },
        // B holds extra cards so a throw-in still passes the per-bout
        // capacity check (which is bounded by min(firstBoutLimit, defenderHand)).
        {
          id: 'B',
          hand: [
            card('hearts', 10),
            card('clubs', 7),
            card('clubs', 8),
            card('clubs', 9),
            card('clubs', 10),
            card('clubs', 11),
          ],
        },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'clubs',
      // Cheating enabled so the bout enters `bout_settle` after the beat
      // (otherwise the engine auto-closes the bout on the last beat).
      settings: { cheatingEnabled: true, cheatAttempts: 1 },
    });
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
    if (!r1.ok) throw new Error();
    const r2 = applyCommand(r1.state, {
      type: 'beat',
      playerId: 'B',
      attackEntryId: r1.state.table.attacks[0].id,
      defenseCardId: 'hearts-10',
    });
    if (!r2.ok) throw new Error();
    expect(r2.state.status).toBe('bout_settle');
    // Throw in a same-rank 6♠ while in bout_settle.
    const r3 = applyCommand(r2.state, {
      type: 'attack',
      playerId: 'A',
      cardId: 'spades-6',
    });
    if (!r3.ok) throw new Error();
    expect(r3.state.status).toBe('bout_defense');
    expect(r3.state.table.attacks).toHaveLength(2);
    expect(r3.state.table.attacks[1].beatenBy).toBeNull();
  });

  it('throw-in capacity is bounded by INITIAL defender hand size, not current', () => {
    // Regression: in late bouts a defender who has, say, 4 cards at the
    // start of the bout should be able to face up to 4 attacks. Earlier the
    // engine used the defender's CURRENT hand length, so once they had beaten
    // two cards (hand → 2) and the table already held two beaten attacks,
    // `attacksRemaining` would clamp to 0 and any further throw-in was
    // rejected with ATTACK_LIMIT_REACHED even though the bout was nowhere
    // near its real cap.
    //
    // Cheating is enabled here so the bout stays open after each beat (with
    // cheating off the engine auto-closes the bout as soon as the table is
    // fully beaten, ending the bout before we can stress the throw-in cap).
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6), card('diamonds', 6), card('spades', 6)] },
        // Defender starts the bout with 4 cards.
        {
          id: 'B',
          hand: [card('hearts', 10), card('diamonds', 10), card('clubs', 8), card('clubs', 9)],
        },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'clubs',
      boutNumber: 2,
      initialDefenderHandSize: 4,
      settings: { cheatingEnabled: true, cheatAttempts: 1, firstBoutLimit: 6 },
    });
    // A throws two sixes, B beats both. Now B's current hand is 2.
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
    if (!r1.ok) throw new Error();
    const r2 = applyCommand(r1.state, {
      type: 'beat',
      playerId: 'B',
      attackEntryId: r1.state.table.attacks[0].id,
      defenseCardId: 'hearts-10',
    });
    if (!r2.ok) throw new Error();
    const r3 = applyCommand(r2.state, { type: 'attack', playerId: 'A', cardId: 'diamonds-6' });
    if (!r3.ok) throw new Error();
    const r4 = applyCommand(r3.state, {
      type: 'beat',
      playerId: 'B',
      attackEntryId: r3.state.table.attacks[1].id,
      defenseCardId: 'diamonds-10',
    });
    if (!r4.ok) throw new Error();
    expect(r4.state.players[1].hand).toHaveLength(2);
    // Now A wants to throw a third six. Initial hand was 4 → cap is 4 →
    // headroom 4 − 2 = 2. Should be allowed.
    const r5 = applyCommand(r4.state, { type: 'attack', playerId: 'A', cardId: 'spades-6' });
    expect(r5.ok).toBe(true);
    if (!r5.ok) return;
    expect(r5.state.table.attacks).toHaveLength(3);
    expect(r5.state.status).toBe('bout_defense');
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

  // -------------------------------------------------------------------------
  // "пусть берёт" — throw-in window after take is called.
  // -------------------------------------------------------------------------
  describe('bout_take_pending phase', () => {
    it('take with cheating-on parks in bout_take_pending — cards still on table', () => {
      // B has 4 cards so the per-bout cap leaves headroom for further throws
      // (otherwise the engine auto-closes via the saturation path).
      const state = craftGame({
        players: [
          { id: 'A', hand: [card('hearts', 6), card('clubs', 6), card('spades', 6)] },
          {
            id: 'B',
            hand: [card('hearts', 10), card('clubs', 10), card('diamonds', 10), card('spades', 10)],
          },
          { id: 'C', hand: [card('diamonds', 6), card('hearts', 8)] },
        ],
        attackerId: 'A',
        defenderId: 'B',
        trumpSuit: 'clubs',
        settings: { cheatingEnabled: true, cheatAttempts: 1, attackerScope: 'all' },
      });
      const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
      if (!r1.ok) throw new Error();
      const r2 = applyCommand(r1.state, { type: 'take', playerId: 'B' });
      expect(r2.ok).toBe(true);
      if (!r2.ok) return;
      // Cards still on table, defender hand untouched.
      expect(r2.state.status).toBe('bout_take_pending');
      expect(r2.state.table.attacks).toHaveLength(1);
      expect(r2.state.players.find((p) => p.id === 'B')!.hand).toHaveLength(4);
      expect(r2.state.passedPlayerIds).toHaveLength(0);
      // DefenderTookCalled event emitted.
      expect(r2.events.some((e) => e.type === 'DefenderTookCalled' && e.defenderId === 'B')).toBe(
        true,
      );
      // BoutEnded must NOT have fired yet.
      expect(r2.events.some((e) => e.type === 'BoutEnded')).toBe(false);
    });

    it('throw-in with cheating-on cancels take and reverts to bout_defense', () => {
      // With cheating enabled the defender must keep the ability to react to a
      // throw-in (beat it, notice a cheat, or re-press "Беру"). A fresh
      // throw-in therefore reverts the parked take into `bout_defense` and
      // wipes any "пусть берёт" votes.
      const state = craftGame({
        players: [
          { id: 'A', hand: [card('hearts', 6), card('clubs', 6), card('spades', 6)] },
          {
            id: 'B',
            hand: [card('hearts', 10), card('clubs', 10), card('diamonds', 10), card('spades', 10)],
          },
          { id: 'C', hand: [card('diamonds', 6), card('hearts', 8)] },
        ],
        attackerId: 'A',
        defenderId: 'B',
        trumpSuit: 'clubs',
        settings: { cheatingEnabled: true, cheatAttempts: 1, attackerScope: 'all' },
      });
      const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
      if (!r1.ok) throw new Error();
      const r2 = applyCommand(r1.state, { type: 'take', playerId: 'B' });
      if (!r2.ok) throw new Error();
      // C says "пусть берёт" first to make sure the throw-in actually wipes
      // the prior pass votes.
      const r3 = applyCommand(r2.state, { type: 'pass', playerId: 'C' });
      if (!r3.ok) throw new Error();
      expect(r3.state.passedPlayerIds).toEqual(['C']);
      const r4 = applyCommand(r3.state, { type: 'attack', playerId: 'A', cardId: 'clubs-6' });
      expect(r4.ok).toBe(true);
      if (!r4.ok) return;
      // Status reverted: defender B regains the full bout_defense option set.
      expect(r4.state.status).toBe('bout_defense');
      expect(r4.state.table.attacks).toHaveLength(2);
      expect(r4.state.passedPlayerIds).toHaveLength(0);
      // Defender role unchanged.
      expect(r4.state.players[r4.state.currentDefenderIndex].id).toBe('B');
    });

    it('throw-in with cheating-OFF keeps bout_take_pending (no revert)', () => {
      // Mirror of the cheating-on revert test: with cheating disabled there is
      // no cheat to catch, so a legal throw-in appends another card but the
      // defender stays parked in `bout_take_pending`.
      const state = craftGame({
        players: [
          { id: 'A', hand: [card('hearts', 6), card('clubs', 6), card('spades', 6)] },
          {
            id: 'B',
            hand: [card('hearts', 10), card('clubs', 10), card('diamonds', 10), card('spades', 10)],
          },
          { id: 'C', hand: [card('diamonds', 6), card('hearts', 8)] },
        ],
        attackerId: 'A',
        defenderId: 'B',
        trumpSuit: 'clubs',
        settings: { cheatingEnabled: false, attackerScope: 'all' },
      });
      const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
      if (!r1.ok) throw new Error();
      const r2 = applyCommand(r1.state, { type: 'take', playerId: 'B' });
      if (!r2.ok) throw new Error();
      expect(r2.state.status).toBe('bout_take_pending');
      const r3 = applyCommand(r2.state, { type: 'pass', playerId: 'C' });
      if (!r3.ok) throw new Error();
      expect(r3.state.passedPlayerIds).toEqual(['C']);
      const r4 = applyCommand(r3.state, { type: 'attack', playerId: 'A', cardId: 'clubs-6' });
      expect(r4.ok).toBe(true);
      if (!r4.ok) return;
      // Stays parked — cheating-off behaviour unchanged.
      expect(r4.state.status).toBe('bout_take_pending');
      expect(r4.state.table.attacks).toHaveLength(2);
      expect(r4.state.passedPlayerIds).toHaveLength(0);
    });

    it('cheating-on: defender can re-press "Беру" after a throw-in revert', () => {
      // After the throw-in reverts to bout_defense the defender must be able
      // to call take again, returning to bout_take_pending with the larger
      // table.
      const state = craftGame({
        players: [
          { id: 'A', hand: [card('hearts', 6), card('clubs', 6)] },
          {
            id: 'B',
            hand: [card('hearts', 10), card('clubs', 10), card('diamonds', 10), card('spades', 10)],
          },
          { id: 'C', hand: [card('diamonds', 6), card('hearts', 8)] },
        ],
        attackerId: 'A',
        defenderId: 'B',
        trumpSuit: 'clubs',
        settings: { cheatingEnabled: true, cheatAttempts: 1, attackerScope: 'all' },
      });
      const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
      if (!r1.ok) throw new Error();
      const r2 = applyCommand(r1.state, { type: 'take', playerId: 'B' });
      if (!r2.ok) throw new Error();
      expect(r2.state.status).toBe('bout_take_pending');
      const r3 = applyCommand(r2.state, { type: 'attack', playerId: 'A', cardId: 'clubs-6' });
      if (!r3.ok) throw new Error();
      expect(r3.state.status).toBe('bout_defense');
      // Defender re-presses "Беру" — engine must accept and park again.
      const r4 = applyCommand(r3.state, { type: 'take', playerId: 'B' });
      expect(r4.ok).toBe(true);
      if (!r4.ok) return;
      expect(r4.state.status).toBe('bout_take_pending');
      expect(r4.state.table.attacks).toHaveLength(2);
    });

    it('cheating-on: defender can notice_cheat on an off-rank throw-in after revert', () => {
      // The whole point of the revert: a cheater throws a rank-mismatched card
      // during the parked take; defender can now call notice_cheat, the fake
      // card returns to the cheater's hand, the cheater loses one attempt.
      const state = craftGame({
        players: [
          // A throws a legal 6 then an off-rank 14 (Ace).
          { id: 'A', hand: [card('hearts', 6), card('clubs', 14)] },
          {
            id: 'B',
            hand: [card('hearts', 10), card('clubs', 10), card('diamonds', 10), card('spades', 10)],
          },
          { id: 'C', hand: [card('diamonds', 6), card('hearts', 8)] },
        ],
        attackerId: 'A',
        defenderId: 'B',
        trumpSuit: 'clubs',
        settings: { cheatingEnabled: true, cheatAttempts: 1, attackerScope: 'all' },
      });
      const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
      if (!r1.ok) throw new Error();
      const r2 = applyCommand(r1.state, { type: 'take', playerId: 'B' });
      if (!r2.ok) throw new Error();
      expect(r2.state.status).toBe('bout_take_pending');
      // A cheats: clubs-14 doesn't match the 6 on the table.
      const r3 = applyCommand(r2.state, { type: 'attack', playerId: 'A', cardId: 'clubs-14' });
      if (!r3.ok) throw new Error();
      expect(r3.state.status).toBe('bout_defense');
      expect(r3.state.table.attacks).toHaveLength(2);
      const cheatEntryId = r3.state.table.attacks[1].id;
      // B catches the cheat.
      const r4 = applyCommand(r3.state, {
        type: 'notice_cheat',
        playerId: 'B',
        attackEntryId: cheatEntryId,
      });
      expect(r4.ok).toBe(true);
      if (!r4.ok) return;
      // The fake card returns to A's hand, table shrinks back to one entry.
      expect(r4.state.table.attacks).toHaveLength(1);
      const handA = r4.state.players.find((p) => p.id === 'A')!.hand;
      expect(handA.map((c) => c.id)).toContain('clubs-14');
      // A's cheat-attempts counter decremented.
      expect(r4.state.cheatAttemptsRemaining['A']).toBe(0);
      // Defender stays defender; bout did not end.
      expect(r4.state.players[r4.state.currentDefenderIndex].id).toBe('B');
      expect(r4.events.some((e) => e.type === 'BoutEnded')).toBe(false);
    });

    it('throw-in with an off-rank card and cheating-off is rejected during bout_take_pending', () => {
      const state = craftGame({
        players: [
          { id: 'A', hand: [card('hearts', 6), card('clubs', 14)] },
          {
            id: 'B',
            hand: [card('hearts', 10), card('clubs', 10), card('diamonds', 10)],
          },
          { id: 'C', hand: [card('hearts', 8)] },
        ],
        attackerId: 'A',
        defenderId: 'B',
        trumpSuit: 'spades',
        settings: { cheatingEnabled: false, attackerScope: 'all' },
      });
      const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
      if (!r1.ok) throw new Error();
      const r2 = applyCommand(r1.state, { type: 'take', playerId: 'B' });
      if (!r2.ok) throw new Error();
      // B's initial hand was 3, cap=3, table has 1 → still room. Take parked.
      expect(r2.state.status).toBe('bout_take_pending');
      const r3 = applyCommand(r2.state, { type: 'attack', playerId: 'A', cardId: 'clubs-14' });
      expect(r3.ok).toBe(false);
      if (!r3.ok) expect(r3.code).toBe('CARD_RANK_NOT_ON_TABLE');
    });

    it('beat command in bout_take_pending is rejected', () => {
      const state = craftGame({
        players: [
          { id: 'A', hand: [card('hearts', 6)] },
          { id: 'B', hand: [card('hearts', 10), card('clubs', 10), card('diamonds', 10)] },
          { id: 'C', hand: [card('hearts', 8)] },
        ],
        attackerId: 'A',
        defenderId: 'B',
        trumpSuit: 'clubs',
        settings: { cheatingEnabled: true, cheatAttempts: 1, attackerScope: 'all' },
      });
      const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
      if (!r1.ok) throw new Error();
      const r2 = applyCommand(r1.state, { type: 'take', playerId: 'B' });
      if (!r2.ok) throw new Error();
      expect(r2.state.status).toBe('bout_take_pending');
      const entryId = r2.state.table.attacks[0].id;
      const r3 = applyCommand(r2.state, {
        type: 'beat',
        playerId: 'B',
        attackEntryId: entryId,
        defenseCardId: 'hearts-10',
      });
      expect(r3.ok).toBe(false);
      if (!r3.ok) expect(r3.code).toBe('BEAT_NOT_ALLOWED');
    });

    it('translate command in bout_take_pending is rejected', () => {
      const state = craftGame({
        players: [
          { id: 'A', hand: [card('hearts', 6)] },
          {
            id: 'B',
            hand: [card('clubs', 6), card('hearts', 10), card('diamonds', 10)],
          },
          {
            id: 'C',
            hand: [card('diamonds', 6), card('hearts', 8), card('clubs', 8)],
          },
        ],
        attackerId: 'A',
        defenderId: 'B',
        trumpSuit: 'spades',
        settings: { cheatingEnabled: true, cheatAttempts: 1, attackerScope: 'all' },
      });
      const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
      if (!r1.ok) throw new Error();
      const r2 = applyCommand(r1.state, { type: 'take', playerId: 'B' });
      if (!r2.ok) throw new Error();
      expect(r2.state.status).toBe('bout_take_pending');
      const r3 = applyCommand(r2.state, {
        type: 'translate',
        playerId: 'B',
        cardId: 'clubs-6',
      });
      expect(r3.ok).toBe(false);
      if (!r3.ok) expect(r3.code).toBe('TRANSLATE_NOT_ALLOWED');
    });

    it('single pass in bout_take_pending does not close the bout', () => {
      const state = craftGame({
        players: [
          { id: 'A', hand: [card('hearts', 6)] },
          { id: 'B', hand: [card('hearts', 10), card('clubs', 10), card('diamonds', 10)] },
          { id: 'C', hand: [card('hearts', 8)] },
        ],
        attackerId: 'A',
        defenderId: 'B',
        trumpSuit: 'clubs',
        settings: { cheatingEnabled: true, cheatAttempts: 1, attackerScope: 'all' },
      });
      const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
      if (!r1.ok) throw new Error();
      const r2 = applyCommand(r1.state, { type: 'take', playerId: 'B' });
      if (!r2.ok) throw new Error();
      // Only A passes — C still hasn't acknowledged.
      const r3 = applyCommand(r2.state, { type: 'pass', playerId: 'A' });
      expect(r3.ok).toBe(true);
      if (!r3.ok) return;
      expect(r3.state.status).toBe('bout_take_pending');
      expect(r3.state.table.attacks).toHaveLength(1);
      expect(r3.state.passedPlayerIds).toEqual(['A']);
    });

    it('all passes in bout_take_pending closes via closeBoutTaken — cards go to defender', () => {
      // Each player keeps an extra card after the bout so nobody finishes —
      // simplifies rotation assertions.
      const state = craftGame({
        players: [
          { id: 'A', hand: [card('hearts', 6), card('diamonds', 2)] },
          {
            id: 'B',
            hand: [card('hearts', 10), card('clubs', 10), card('diamonds', 10), card('spades', 10)],
          },
          { id: 'C', hand: [card('clubs', 7), card('diamonds', 4)] },
        ],
        attackerId: 'A',
        defenderId: 'B',
        trumpSuit: 'spades',
        settings: { cheatingEnabled: true, cheatAttempts: 1, attackerScope: 'all' },
      });
      const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
      if (!r1.ok) throw new Error();
      const r2 = applyCommand(r1.state, { type: 'take', playerId: 'B' });
      if (!r2.ok) throw new Error();
      expect(r2.state.status).toBe('bout_take_pending');
      const r3 = applyCommand(r2.state, { type: 'pass', playerId: 'A' });
      if (!r3.ok) throw new Error();
      expect(r3.state.status).toBe('bout_take_pending');
      const r4 = applyCommand(r3.state, { type: 'pass', playerId: 'C' });
      expect(r4.ok).toBe(true);
      if (!r4.ok) return;
      // Bout closed: table cleared, defender holds the original 4 cards plus
      // the attacker's hearts-6.
      expect(r4.state.table.attacks).toHaveLength(0);
      expect(r4.state.boutNumber).toBe(2);
      const defenderHand = r4.state.players.find((p) => p.id === 'B')!.hand;
      expect(defenderHand.map((c) => c.id)).toContain('hearts-6');
      // Outcome event present and equals `taken`.
      expect(r4.events.some((e) => e.type === 'BoutEnded' && e.outcome === 'taken')).toBe(true);
      // After take rotation: next attacker is the player after the defender (C).
      expect(r4.state.players[r4.state.currentAttackerIndex].id).toBe('C');
    });

    it('auto-closes when cheating is OFF and the per-bout cap saturates', () => {
      // cap=1 (defender holds 1 card to start). After A's attack the cap is
      // saturated, so reduceTake skips the parked-phase and closes outright.
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
      const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
      if (!r1.ok) throw new Error();
      const r2 = applyCommand(r1.state, { type: 'take', playerId: 'B' });
      expect(r2.ok).toBe(true);
      if (!r2.ok) return;
      // No parked phase — bout fully closed.
      expect(r2.state.status).not.toBe('bout_take_pending');
      expect(r2.state.table.attacks).toHaveLength(0);
      expect(r2.state.boutNumber).toBe(2);
      // Both events present.
      expect(r2.events.some((e) => e.type === 'DefenderTookCalled')).toBe(true);
      expect(r2.events.some((e) => e.type === 'BoutEnded' && e.outcome === 'taken')).toBe(true);
    });

    it('thrower with an empty hand is auto-counted as passed', () => {
      // Regression: a "пусть берёт" vote shouldn't wait on a player who
      // physically can't add another card. Setup (cheating-OFF so the take
      // stays parked through the throw-in instead of reverting to bout_defense):
      //   - A attacks 6♥, B (defender) takes — bout parked in bout_take_pending.
      //   - C throws his last card (6♣) — C is now hand-empty.
      //   - D passes — only D is eligible (A also hand-empty, C hand-empty).
      //     The bout therefore closes via closeBoutTaken.
      const state = craftGame({
        players: [
          // A holds only the opening 6♥; after attacking, A's hand is empty.
          // A is NOT in finishedPlayers yet — the bout is still open — but the
          // empty-hand filter must already exclude A from the eligible set.
          { id: 'A', hand: [card('hearts', 6)] },
          // B's hand keeps the per-bout cap open so C's throw-in lands.
          // initialDefenderHandSize = 4 → cap headroom = 4.
          {
            id: 'B',
            hand: [card('hearts', 10), card('clubs', 10), card('diamonds', 10), card('spades', 10)],
          },
          // C holds exactly the throw-in card; once played his hand is empty.
          { id: 'C', hand: [card('clubs', 6)] },
          // D is the only thrower with cards left after C empties out.
          { id: 'D', hand: [card('hearts', 8), card('diamonds', 4)] },
        ],
        attackerId: 'A',
        defenderId: 'B',
        trumpSuit: 'spades',
        // Cheating-off: throw-ins during bout_take_pending keep the parked
        // status (no revert to bout_defense), so we can observe the eligible-
        // filter behaviour cleanly on the pass.
        settings: { cheatingEnabled: false, attackerScope: 'all' },
      });
      const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
      if (!r1.ok) throw new Error();
      expect(r1.state.players.find((p) => p.id === 'A')!.hand).toHaveLength(0);
      const r2 = applyCommand(r1.state, { type: 'take', playerId: 'B' });
      if (!r2.ok) throw new Error();
      expect(r2.state.status).toBe('bout_take_pending');
      // C throws his last card. Status stays bout_take_pending (cheating-off);
      // C's hand is now empty but C isn't finished yet (bout still open).
      const r3 = applyCommand(r2.state, { type: 'attack', playerId: 'C', cardId: 'clubs-6' });
      if (!r3.ok) throw new Error();
      expect(r3.state.status).toBe('bout_take_pending');
      expect(r3.state.players.find((p) => p.id === 'C')!.hand).toHaveLength(0);
      expect(r3.state.finishedPlayers).not.toContain('C');
      // D passes. A and C both have empty hands → eligible set is just {D}.
      // Bout closes.
      const r4 = applyCommand(r3.state, { type: 'pass', playerId: 'D' });
      expect(r4.ok).toBe(true);
      if (!r4.ok) return;
      expect(r4.state.status).not.toBe('bout_take_pending');
      expect(r4.state.table.attacks).toHaveLength(0);
      expect(r4.events.some((e) => e.type === 'BoutEnded' && e.outcome === 'taken')).toBe(true);
    });

    it('empty-handed thrower is still excluded from eligible set while other throwers remain', () => {
      // Companion to the test above: when C (hand-empty) drops out of the
      // eligible set but D AND A still have cards, the bout must NOT close
      // on the first pass — we still need both A and D to acknowledge.
      const state = craftGame({
        players: [
          // A retains a card so they remain in the eligible set after their
          // attack. Use the same rank for the second card so it can match the
          // table on a later throw-in.
          { id: 'A', hand: [card('hearts', 6), card('diamonds', 6)] },
          {
            id: 'B',
            hand: [card('hearts', 10), card('clubs', 10), card('diamonds', 10), card('spades', 10)],
          },
          { id: 'C', hand: [card('clubs', 6)] },
          { id: 'D', hand: [card('hearts', 8), card('diamonds', 4)] },
        ],
        attackerId: 'A',
        defenderId: 'B',
        trumpSuit: 'spades',
        settings: { cheatingEnabled: false, attackerScope: 'all' },
      });
      const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
      if (!r1.ok) throw new Error();
      const r2 = applyCommand(r1.state, { type: 'take', playerId: 'B' });
      if (!r2.ok) throw new Error();
      // C throws his last card; bout stays parked, C is hand-empty.
      const r3 = applyCommand(r2.state, { type: 'attack', playerId: 'C', cardId: 'clubs-6' });
      if (!r3.ok) throw new Error();
      expect(r3.state.status).toBe('bout_take_pending');
      expect(r3.state.players.find((p) => p.id === 'C')!.hand).toHaveLength(0);
      // D passes — bout should still be parked because A still holds a card.
      const r4 = applyCommand(r3.state, { type: 'pass', playerId: 'D' });
      if (!r4.ok) throw new Error();
      expect(r4.state.status).toBe('bout_take_pending');
      expect(r4.state.passedPlayerIds).toEqual(['D']);
      // A passes — now A and D are both done, C is excluded by the empty-hand
      // filter, so the bout finally closes.
      const r5 = applyCommand(r4.state, { type: 'pass', playerId: 'A' });
      expect(r5.ok).toBe(true);
      if (!r5.ok) return;
      expect(r5.state.status).not.toBe('bout_take_pending');
      expect(r5.events.some((e) => e.type === 'BoutEnded' && e.outcome === 'taken')).toBe(true);
    });
  });
});

describe('pass / bout settle', () => {
  it('all-pass closes bout into beaten; defender becomes attacker', () => {
    // Each player keeps an extra card after the bout so nobody finishes —
    // we want to assert role rotation, not game-over edge cases.
    //
    // Cheating enabled so the bout enters `bout_settle` after the final beat
    // (with cheating off the bout would auto-close and pass would never run).
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6), card('diamonds', 2)] },
        { id: 'B', hand: [card('hearts', 10), card('diamonds', 3)] },
        { id: 'C', hand: [card('clubs', 7), card('diamonds', 4)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: true, cheatAttempts: 1, attackerScope: 'all' },
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

  it('limit=5 stays at 5 in bout 1; once first-defense latch flips switches to min(6, defenderHand)', () => {
    // Construct a state at bout 2 directly WITH the first-defense latch
    // set — i.e. the prior bout closed via successful defense, so the cap is
    // back to the standard min(6, defenderHand). Pure `boutNumber > 1` is no
    // longer enough to relax the cap; the latch governs.
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
      firstDefenseHappened: true,
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
