import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/state/reducers.js';
import { card, craftGame } from '../src/_testing/fixtures.js';

describe('translate', () => {
  it('simple translate rotates roles by one seat', () => {
    // A attacks 7H, B (defender) translates with 7D; new defender = C,
    // new attacker = B. Both 7s are on the table as attacks.
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 7), card('spades', 9)] },
        { id: 'B', hand: [card('diamonds', 7), card('spades', 10)] },
        { id: 'C', hand: [card('clubs', 8), card('hearts', 11), card('diamonds', 12)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: false, attackerScope: 'all' },
    });
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-7' });
    if (!r1.ok) throw new Error(`r1 failed: ${r1.code}`);
    const r2 = applyCommand(r1.state, {
      type: 'translate',
      playerId: 'B',
      cardId: 'diamonds-7',
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.players[r2.state.currentAttackerIndex].id).toBe('B');
    expect(r2.state.players[r2.state.currentDefenderIndex].id).toBe('C');
    expect(r2.state.table.attacks).toHaveLength(2);
    expect(r2.state.table.attacks.map((a) => a.card.id)).toEqual(['hearts-7', 'diamonds-7']);
    expect(r2.state.table.attacks.every((a) => a.beatenBy === null)).toBe(true);
    expect(r2.events[0]).toMatchObject({
      type: 'CardTranslated',
      fromPlayerId: 'B',
      newDefenderId: 'C',
    });
  });

  it('chained translates: 4 players translate the same rank around the table', () => {
    // A attacks 6H; B translates 6S; C translates 6D; D ends as defender
    // (next seat after C).
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6), card('clubs', 9)] },
        { id: 'B', hand: [card('spades', 6), card('clubs', 9)] },
        { id: 'C', hand: [card('diamonds', 6), card('clubs', 9)] },
        {
          id: 'D',
          hand: [card('hearts', 9), card('hearts', 10), card('hearts', 11), card('hearts', 12)],
        },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'clubs',
      settings: { cheatingEnabled: false, attackerScope: 'all' },
    });
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
    if (!r1.ok) throw new Error();
    const r2 = applyCommand(r1.state, {
      type: 'translate',
      playerId: 'B',
      cardId: 'spades-6',
    });
    if (!r2.ok) throw new Error(`r2: ${r2.code}`);
    expect(r2.state.players[r2.state.currentDefenderIndex].id).toBe('C');
    const r3 = applyCommand(r2.state, {
      type: 'translate',
      playerId: 'C',
      cardId: 'diamonds-6',
    });
    if (!r3.ok) throw new Error(`r3: ${r3.code}`);
    expect(r3.state.players[r3.state.currentAttackerIndex].id).toBe('C');
    expect(r3.state.players[r3.state.currentDefenderIndex].id).toBe('D');
    expect(r3.state.table.attacks).toHaveLength(3);
  });

  it('rejects translate when the table has mixed ranks (e.g. after a throw of a different rank)', () => {
    // Simulate a state where two different ranks are on the table — translate
    // is forbidden because there is no single shared rank.
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 9)] },
        { id: 'B', hand: [card('diamonds', 7), card('clubs', 8)] },
        { id: 'C', hand: [card('hearts', 11), card('hearts', 12), card('hearts', 13)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: false, attackerScope: 'all' },
    });
    // Open with rank 9, then throw a rank 8 (this would not normally be
    // allowed by the rank rule but cheating-disabled engine rejects mismatch.
    // For this test we instead start with a hand-crafted table by sending
    // two attacks of different ranks via cheating-enabled mode just for
    // setup, then assert translate fails on the result.
    const cheatState = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 9), card('clubs', 8)] },
        { id: 'B', hand: [card('diamonds', 7), card('clubs', 7)] },
        { id: 'C', hand: [card('hearts', 11), card('hearts', 12), card('hearts', 13)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: true, cheatAttempts: 1, attackerScope: 'all' },
    });
    const t1 = applyCommand(cheatState, { type: 'attack', playerId: 'A', cardId: 'hearts-9' });
    if (!t1.ok) throw new Error();
    const t2 = applyCommand(t1.state, { type: 'attack', playerId: 'A', cardId: 'clubs-8' });
    if (!t2.ok) throw new Error();
    // Now defender tries to translate with rank 7 — fails (mixed ranks).
    const t3 = applyCommand(t2.state, {
      type: 'translate',
      playerId: 'B',
      cardId: 'diamonds-7',
    });
    expect(t3.ok).toBe(false);
    if (!t3.ok) expect(t3.code).toBe('TRANSLATE_NOT_ALLOWED');
    void state;
  });

  it('rejects translate when next defender does not have enough cards to cover stack', () => {
    // After translation there would be 2 attacks; next defender (C) holds 1
    // card -> not enough.
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6), card('clubs', 9)] },
        { id: 'B', hand: [card('diamonds', 6), card('clubs', 9)] },
        { id: 'C', hand: [card('hearts', 11)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: false, attackerScope: 'all' },
    });
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
    if (!r1.ok) throw new Error();
    const r2 = applyCommand(r1.state, {
      type: 'translate',
      playerId: 'B',
      cardId: 'diamonds-6',
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('TRANSLATE_NOT_ALLOWED');
  });

  it('rejects translate after defender has already beaten an attack', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6)] },
        { id: 'B', hand: [card('hearts', 10), card('diamonds', 6)] },
        { id: 'C', hand: [card('clubs', 7), card('clubs', 8), card('clubs', 9)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: false, attackerScope: 'all' },
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
    // Now B can't translate — already defended this bout.
    const r3 = applyCommand(r2.state, {
      type: 'translate',
      playerId: 'B',
      cardId: 'diamonds-6',
    });
    expect(r3.ok).toBe(false);
  });

  it('attacker_only scope after translate: only the new attacker (ex-defender) may throw', () => {
    // A -> B translate; B is now attacker. With attackerScope='attacker_only'
    // the ORIGINAL attacker A is no longer allowed to throw; only B (the
    // last translator / current attacker) can.
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6), card('spades', 6)] },
        { id: 'B', hand: [card('diamonds', 6), card('clubs', 9)] },
        {
          id: 'C',
          hand: [card('clubs', 10), card('clubs', 11), card('clubs', 12), card('clubs', 13)],
        },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: false, attackerScope: 'attacker_only' },
    });
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
    if (!r1.ok) throw new Error();
    const r2 = applyCommand(r1.state, {
      type: 'translate',
      playerId: 'B',
      cardId: 'diamonds-6',
    });
    if (!r2.ok) throw new Error(`r2: ${r2.code}`);
    expect(r2.state.players[r2.state.currentAttackerIndex].id).toBe('B');
    // A is no longer the attacker — they may not throw any more.
    const rA = applyCommand(r2.state, { type: 'attack', playerId: 'A', cardId: 'spades-6' });
    expect(rA.ok).toBe(false);
    if (!rA.ok) expect(rA.code).toBe('NOT_YOUR_TURN');
    // C is defender — also forbidden (defender can't throw).
    // B (new attacker) is allowed; assume they don't have a matching rank-6
    // ready besides what's used — they do have a clubs-9. clubs-9 is not on
    // the table so the rank rule would reject. Instead, just verify B is
    // CONSIDERED the attacker via the role check.
  });

  it('after translate the ex-defender plays as attacker in the same bout (continues throwing)', () => {
    // A attacks 7H; B translates 7D; B (new attacker) may throw a third 7
    // because all on-table ranks match.
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 7), card('spades', 9)] },
        { id: 'B', hand: [card('diamonds', 7), card('spades', 7), card('clubs', 9)] },
        {
          id: 'C',
          hand: [card('clubs', 10), card('clubs', 11), card('clubs', 12), card('clubs', 13)],
        },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: false, attackerScope: 'all' },
    });
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-7' });
    if (!r1.ok) throw new Error();
    const r2 = applyCommand(r1.state, {
      type: 'translate',
      playerId: 'B',
      cardId: 'diamonds-7',
    });
    if (!r2.ok) throw new Error(`r2: ${r2.code}`);
    // B is now attacker — throws another 7 onto the table targeting C.
    const r3 = applyCommand(r2.state, { type: 'attack', playerId: 'B', cardId: 'spades-7' });
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    expect(r3.state.table.attacks).toHaveLength(3);
    expect(r3.state.players[r3.state.currentDefenderIndex].id).toBe('C');
  });
});
