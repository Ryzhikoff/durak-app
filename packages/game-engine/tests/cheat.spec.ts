import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/state/reducers.js';
import { card, craftGame } from '../src/_testing/fixtures.js';

describe('cheating disabled', () => {
  it('rejects illegal attack rank with CARD_RANK_NOT_ON_TABLE', () => {
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
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
    if (!r1.ok) throw new Error();
    const r2 = applyCommand(r1.state, { type: 'attack', playerId: 'A', cardId: 'clubs-14' });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('CARD_RANK_NOT_ON_TABLE');
  });

  it('rejects illegal defense with CARD_DOES_NOT_BEAT', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 10)] },
        { id: 'B', hand: [card('hearts', 6)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: false },
    });
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-10' });
    if (!r1.ok) throw new Error();
    const r2 = applyCommand(r1.state, {
      type: 'beat',
      playerId: 'B',
      attackEntryId: r1.state.table.attacks[0].id,
      defenseCardId: 'hearts-6',
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('CARD_DOES_NOT_BEAT');
  });

  it('rejects notice_cheat with CHEAT_DISABLED when cheating is off', () => {
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
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
    if (!r1.ok) throw new Error();
    const r2 = applyCommand(r1.state, {
      type: 'notice_cheat',
      playerId: 'B',
      attackEntryId: r1.state.table.attacks[0].id,
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('CHEAT_DISABLED');
  });
});

describe('cheating enabled', () => {
  it('accepts illegal defense card without immediate error', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 10)] },
        { id: 'B', hand: [card('hearts', 6)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: { cheatingEnabled: true, cheatAttempts: 1 },
    });
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-10' });
    if (!r1.ok) throw new Error();
    const r2 = applyCommand(r1.state, {
      type: 'beat',
      playerId: 'B',
      attackEntryId: r1.state.table.attacks[0].id,
      defenseCardId: 'hearts-6',
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    // The cheat exists on the table until someone notices.
    expect(r2.state.table.attacks[0].beatenBy?.id).toBe('hearts-6');
  });

  it('notice_cheat on an illegal earlier throw is NOT laundered by later legitimate same-rank throws', () => {
    // Regression: when later valid throws of a rank R join the table, an
    // earlier illegal throw of a *different* rank used to look legal because
    // the engine checked the entry against ALL OTHER cards currently on the
    // table — including the legitimate R-cards that were thrown AFTER it.
    // The fix is to evaluate the entry against entries that PRECEDED it.
    //
    // Scenario: bout opens with 3♦, attacker (cheating-on) throws Q♣ (cheat,
    // doesn't match rank 3), then someone genuinely throws 4♦ and another
    // genuinely throws 4♣ — both 4s are illegitimate too because the only
    // legal rank at their time was still 3 (the Q is a cheat). Noticing the
    // Q♣ must still report it as a cheat.
    const state = craftGame({
      players: [
        {
          id: 'A',
          hand: [
            card('diamonds', 3),
            card('clubs', 12),
            card('diamonds', 4),
            card('clubs', 4),
          ],
        },
        // Defender holds enough cards to keep the throw-in cap open.
        {
          id: 'B',
          hand: [
            card('hearts', 7),
            card('hearts', 8),
            card('hearts', 9),
            card('hearts', 10),
            card('hearts', 11),
            card('hearts', 13),
          ],
        },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'hearts',
      settings: {
        cheatingEnabled: true,
        cheatAttempts: 2,
        cheatNoticeScope: 'all',
      },
    });
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'diamonds-3' });
    if (!r1.ok) throw new Error(`r1: ${r1.code}`);
    const r2 = applyCommand(r1.state, { type: 'attack', playerId: 'A', cardId: 'clubs-12' });
    if (!r2.ok) throw new Error(`r2: ${r2.code}`);
    const r3 = applyCommand(r2.state, { type: 'attack', playerId: 'A', cardId: 'diamonds-4' });
    if (!r3.ok) throw new Error(`r3: ${r3.code}`);
    const r4 = applyCommand(r3.state, { type: 'attack', playerId: 'A', cardId: 'clubs-4' });
    if (!r4.ok) throw new Error(`r4: ${r4.code}`);
    // Defender notices the Q♣ (second entry).
    const qEntry = r4.state.table.attacks[1];
    const r5 = applyCommand(r4.state, {
      type: 'notice_cheat',
      playerId: 'B',
      attackEntryId: qEntry.id,
    });
    expect(r5.ok).toBe(true);
    if (!r5.ok) return;
    const cheatEvent = r5.events.find((e) => e.type === 'CheatNoticed');
    expect(cheatEvent).toMatchObject({ succeeded: true, cheaterId: 'A' });
    // Q♣ returns to A's hand, leaving the legitimate-looking 4s and the
    // original 3 on the table.
    expect(r5.state.table.attacks.find((a) => a.id === qEntry.id)).toBeUndefined();
    expect(r5.state.players[0].hand.some((c) => c.id === 'clubs-12')).toBe(true);
  });

  it('notice_cheat on a LEGAL beat returns succeeded=false and consumes no attempt', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6), card('clubs', 9)] },
        { id: 'B', hand: [card('hearts', 10), card('clubs', 7)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: {
        cheatingEnabled: true,
        cheatAttempts: 2,
        cheatNoticeScope: 'all',
      },
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
    const beforeAttempts = r2.state.cheatAttemptsRemaining['A'];
    // A (attacker) cries cheat on a perfectly legal beat — they're wrong.
    const r3 = applyCommand(r2.state, {
      type: 'notice_cheat',
      playerId: 'A',
      attackEntryId: r2.state.table.attacks[0].id,
    });
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    const cheatEvent = r3.events.find((e) => e.type === 'CheatNoticed');
    expect(cheatEvent).toMatchObject({ succeeded: false });
    expect(r3.state.cheatAttemptsRemaining['A']).toBe(beforeAttempts);
    // The defense is still on the table.
    expect(r3.state.table.attacks[0].beatenBy?.id).toBe('hearts-10');
  });

  it('notice_cheat on an ILLEGAL beat returns the card to the defender and emits CheatNoticed', () => {
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 10), card('clubs', 9)] },
        { id: 'B', hand: [card('hearts', 6), card('clubs', 7)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: {
        cheatingEnabled: true,
        cheatAttempts: 1,
        cheatNoticeScope: 'all',
      },
    });
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-10' });
    if (!r1.ok) throw new Error();
    const r2 = applyCommand(r1.state, {
      type: 'beat',
      playerId: 'B',
      attackEntryId: r1.state.table.attacks[0].id,
      defenseCardId: 'hearts-6', // 6 does NOT beat 10
    });
    if (!r2.ok) throw new Error();
    const r3 = applyCommand(r2.state, {
      type: 'notice_cheat',
      playerId: 'A',
      attackEntryId: r2.state.table.attacks[0].id,
    });
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    const cheatEvent = r3.events.find((e) => e.type === 'CheatNoticed');
    expect(cheatEvent).toMatchObject({
      type: 'CheatNoticed',
      succeeded: true,
      noticerId: 'A',
      cheaterId: 'B',
    });
    // Card returned to defender hand.
    const defender = r3.state.players.find((p) => p.id === 'B')!;
    expect(defender.hand.map((c) => c.id)).toContain('hearts-6');
    // Beat entry restored.
    expect(r3.state.table.attacks[0].beatenBy).toBeNull();
    // The CHEATER (B) loses one attempt; the noticer (A) keeps theirs.
    expect(r3.state.cheatAttemptsRemaining['B']).toBe(0);
    expect(r3.state.cheatAttemptsRemaining['A']).toBe(1);
  });

  it('cheater attempts clamp at 0 on repeated cheats; notice still succeeds', () => {
    // The per-bout attempt counter belongs to the CHEATER. After it hits 0
    // subsequent notices still succeed (the engine rolls back the cheat),
    // but the counter clamps at zero rather than going negative.
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 10), card('clubs', 9), card('diamonds', 9)] },
        { id: 'B', hand: [card('hearts', 6), card('diamonds', 5), card('spades', 5)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      settings: {
        cheatingEnabled: true,
        cheatAttempts: 1,
        cheatNoticeScope: 'all',
      },
    });
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-10' });
    if (!r1.ok) throw new Error();
    const r2 = applyCommand(r1.state, {
      type: 'beat',
      playerId: 'B',
      attackEntryId: r1.state.table.attacks[0].id,
      defenseCardId: 'hearts-6',
    });
    if (!r2.ok) throw new Error();
    const r3 = applyCommand(r2.state, {
      type: 'notice_cheat',
      playerId: 'A',
      attackEntryId: r2.state.table.attacks[0].id,
    });
    if (!r3.ok) throw new Error();
    // Cheater B's counter dropped to 0; A (noticer) is untouched.
    expect(r3.state.cheatAttemptsRemaining['B']).toBe(0);
    expect(r3.state.cheatAttemptsRemaining['A']).toBe(1);
    // B cheats again on the same entry.
    const r4 = applyCommand(r3.state, {
      type: 'beat',
      playerId: 'B',
      attackEntryId: r3.state.table.attacks[0].id,
      defenseCardId: 'diamonds-5',
    });
    if (!r4.ok) throw new Error(`r4: ${r4.code}`);
    // A notices again — still succeeds, B's counter clamps at 0.
    const r5 = applyCommand(r4.state, {
      type: 'notice_cheat',
      playerId: 'A',
      attackEntryId: r4.state.table.attacks[0].id,
    });
    expect(r5.ok).toBe(true);
    if (!r5.ok) return;
    expect(r5.state.cheatAttemptsRemaining['B']).toBe(0);
    expect(r5.state.cheatAttemptsRemaining['A']).toBe(1);
    const event = r5.events.find((e) => e.type === 'CheatNoticed');
    expect(event).toMatchObject({ succeeded: true, cheaterId: 'B' });
  });

  describe('cheatNoticeScope=defender_only', () => {
    it('only the defender may notice illegal attacks; others get NOT_YOUR_TURN', () => {
      // C (not defender) tries to notice A's cheating throw → rejected.
      const state = craftGame({
        players: [
          { id: 'A', hand: [card('hearts', 6), card('clubs', 14)] },
          { id: 'B', hand: [card('hearts', 7), card('hearts', 8)] },
          { id: 'C', hand: [card('diamonds', 9), card('diamonds', 10)] },
        ],
        attackerId: 'A',
        defenderId: 'B',
        trumpSuit: 'spades',
        settings: {
          cheatingEnabled: true,
          cheatAttempts: 1,
          cheatNoticeScope: 'defender_only',
          attackerScope: 'all',
        },
      });
      const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
      if (!r1.ok) throw new Error();
      const r2 = applyCommand(r1.state, {
        type: 'attack',
        playerId: 'A',
        cardId: 'clubs-14', // wrong rank — a cheat
      });
      if (!r2.ok) throw new Error(`r2: ${r2.code}`);
      const cheatEntryId = r2.state.table.attacks[1].id;
      // C tries — should be rejected.
      const rC = applyCommand(r2.state, {
        type: 'notice_cheat',
        playerId: 'C',
        attackEntryId: cheatEntryId,
      });
      expect(rC.ok).toBe(false);
      if (!rC.ok) expect(rC.code).toBe('NOT_YOUR_TURN');
      // B (the defender) succeeds.
      const rB = applyCommand(r2.state, {
        type: 'notice_cheat',
        playerId: 'B',
        attackEntryId: cheatEntryId,
      });
      expect(rB.ok).toBe(true);
      if (!rB.ok) return;
      const event = rB.events.find((e) => e.type === 'CheatNoticed');
      expect(event).toMatchObject({ succeeded: true, noticerId: 'B' });
    });
  });

  describe('cheatNoticeScope=defender_only, beat-cheat', () => {
    it('anyone except the defender can notice a beat-cheat regardless of scope', () => {
      const state = craftGame({
        players: [
          { id: 'A', hand: [card('hearts', 10)] },
          { id: 'B', hand: [card('hearts', 6), card('clubs', 7)] },
          { id: 'C', hand: [card('clubs', 9), card('clubs', 10)] },
        ],
        attackerId: 'A',
        defenderId: 'B',
        trumpSuit: 'spades',
        settings: {
          cheatingEnabled: true,
          cheatAttempts: 1,
          cheatNoticeScope: 'defender_only',
          attackerScope: 'all',
        },
      });
      const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-10' });
      if (!r1.ok) throw new Error();
      // B beats illegally (6 does not beat 10).
      const r2 = applyCommand(r1.state, {
        type: 'beat',
        playerId: 'B',
        attackEntryId: r1.state.table.attacks[0].id,
        defenseCardId: 'hearts-6',
      });
      if (!r2.ok) throw new Error();
      // Defender B obviously cannot notice their own bad beat.
      const rB = applyCommand(r2.state, {
        type: 'notice_cheat',
        playerId: 'B',
        attackEntryId: r2.state.table.attacks[0].id,
      });
      expect(rB.ok).toBe(false);
      // Third party C catches the bad beat — scope doesn't gate beat-cheats.
      const rC = applyCommand(r2.state, {
        type: 'notice_cheat',
        playerId: 'C',
        attackEntryId: r2.state.table.attacks[0].id,
      });
      expect(rC.ok).toBe(true);
      if (!rC.ok) return;
      const eventC = rC.events.find((e) => e.type === 'CheatNoticed');
      expect(eventC).toMatchObject({ succeeded: true, noticerId: 'C', cheaterId: 'B' });
    });

    it('attacker can also notice a beat-cheat under defender_only scope', () => {
      const state = craftGame({
        players: [
          { id: 'A', hand: [card('hearts', 10)] },
          { id: 'B', hand: [card('hearts', 6), card('clubs', 7)] },
          { id: 'C', hand: [card('clubs', 9), card('clubs', 10)] },
        ],
        attackerId: 'A',
        defenderId: 'B',
        trumpSuit: 'spades',
        settings: {
          cheatingEnabled: true,
          cheatAttempts: 1,
          cheatNoticeScope: 'defender_only',
          attackerScope: 'all',
        },
      });
      const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-10' });
      if (!r1.ok) throw new Error();
      const r2 = applyCommand(r1.state, {
        type: 'beat',
        playerId: 'B',
        attackEntryId: r1.state.table.attacks[0].id,
        defenseCardId: 'hearts-6',
      });
      if (!r2.ok) throw new Error();
      const rA = applyCommand(r2.state, {
        type: 'notice_cheat',
        playerId: 'A',
        attackEntryId: r2.state.table.attacks[0].id,
      });
      expect(rA.ok).toBe(true);
      if (!rA.ok) return;
      const event = rA.events.find((e) => e.type === 'CheatNoticed');
      expect(event).toMatchObject({ succeeded: true, noticerId: 'A', cheaterId: 'B' });
    });
  });

  describe('cheater attribution survives a translate', () => {
    it('notice_cheat on a pre-translate attack attributes the original attacker as cheater', () => {
      // Setup: 3 players. A attacks with hearts-6 (legal). B translates
      // with diamonds-6. C is the new defender. Now C notices the cheat on
      // the FIRST entry (A's hearts-6) — but the first entry of a bout is
      // always legal, so use a different angle: A cheats by throwing a
      // mismatched-rank card on the table BEFORE the translate happens.
      //
      // To trigger a translate, the table must be single-rank. So instead
      // we engineer the cheat the other way: B (defender) chooses to
      // translate, then sometime later C notices the SECOND entry (the
      // translation card) — but B is the translator/cheater, not A. The
      // key assertion: cheaterId equals B (the translator), not A.
      //
      // A simpler scenario: A puts down a rank-6, B translates with a
      // joker — but our translate-policy forbids jokers. Use rank match
      // instead and assert that after the translate, the noticer cannot
      // find anything illegal to notice (because the table is all rank-6).
      //
      // The cleanest test: have A throw a legal-rank attack #1, then
      // someone throws an illegal-rank attack #2. Then translate is
      // impossible (mixed ranks). So we test it from the OTHER side:
      // before any translate, throw an illegal #2 attack by A — record
      // cheaterId. Then simulate a translate that would rotate roles
      // (impossible with mixed ranks; we use the entry's `attackerId`).
      //
      // -> easiest assertion: after translate, the noticer notices a
      // pre-translate entry that was perfectly legal: cheat doesn't catch
      // (succeeded=false), but the cheaterId field on the event still
      // points at the ORIGINAL attacker (taken from the entry).
      const state = craftGame({
        players: [
          { id: 'A', hand: [card('hearts', 6), card('clubs', 9)] },
          { id: 'B', hand: [card('diamonds', 6), card('clubs', 9)] },
          {
            id: 'C',
            hand: [card('hearts', 10), card('hearts', 11), card('hearts', 12)],
          },
        ],
        attackerId: 'A',
        defenderId: 'B',
        trumpSuit: 'spades',
        settings: {
          cheatingEnabled: true,
          cheatAttempts: 1,
          cheatNoticeScope: 'all',
          attackerScope: 'all',
        },
      });
      const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
      if (!r1.ok) throw new Error();
      const r2 = applyCommand(r1.state, {
        type: 'translate',
        playerId: 'B',
        cardId: 'diamonds-6',
      });
      if (!r2.ok) throw new Error(`r2: ${r2.code}`);
      // After translate, B is the attacker and C the defender. The first
      // entry (hearts-6) still has attackerId='A'. The event must reflect
      // 'A' as the cheaterId for that entry (even though attack #1 is
      // always legal — we're checking attribution, not the outcome).
      const firstEntryId = r2.state.table.attacks[0].id;
      const rNotice = applyCommand(r2.state, {
        type: 'notice_cheat',
        playerId: 'C',
        attackEntryId: firstEntryId,
      });
      expect(rNotice.ok).toBe(true);
      if (!rNotice.ok) return;
      const event = rNotice.events.find((e) => e.type === 'CheatNoticed');
      expect(event).toMatchObject({
        type: 'CheatNoticed',
        cheaterId: 'A', // <-- ORIGINAL attacker, not the current one (B).
        succeeded: false, // first attack of bout is always legal
      });
    });

    it('illegal attack #2 placed BEFORE translate retains correct cheaterId', () => {
      // A places legal hearts-6. A places illegal clubs-14 (rank mismatch).
      // Then the rank rule is off (cheating enabled). B cannot translate
      // (mixed ranks), so test only the cheat-notice attribution. C calls
      // cheat on the clubs-14 entry — succeeded=true, cheaterId=A.
      const state = craftGame({
        players: [
          { id: 'A', hand: [card('hearts', 6), card('clubs', 14)] },
          { id: 'B', hand: [card('diamonds', 6), card('clubs', 9)] },
          { id: 'C', hand: [card('clubs', 11), card('clubs', 12)] },
        ],
        attackerId: 'A',
        defenderId: 'B',
        trumpSuit: 'spades',
        settings: {
          cheatingEnabled: true,
          cheatAttempts: 1,
          cheatNoticeScope: 'all',
          attackerScope: 'all',
        },
      });
      const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
      if (!r1.ok) throw new Error();
      const r2 = applyCommand(r1.state, { type: 'attack', playerId: 'A', cardId: 'clubs-14' });
      if (!r2.ok) throw new Error(r2.code);
      const cheatEntryId = r2.state.table.attacks[1].id;
      const rNotice = applyCommand(r2.state, {
        type: 'notice_cheat',
        playerId: 'C',
        attackEntryId: cheatEntryId,
      });
      expect(rNotice.ok).toBe(true);
      if (!rNotice.ok) return;
      const event = rNotice.events.find((e) => e.type === 'CheatNoticed');
      expect(event).toMatchObject({
        cheaterId: 'A',
        succeeded: true,
      });
      // Cheater A's per-bout attempts decreased.
      expect(rNotice.state.cheatAttemptsRemaining['A']).toBe(0);
      // Noticer C's attempts untouched.
      expect(rNotice.state.cheatAttemptsRemaining['C']).toBe(1);
    });
  });

  describe('cheatNoticeScope=all', () => {
    it('any non-attacker non-finished player may notice an illegal attack', () => {
      const state = craftGame({
        players: [
          { id: 'A', hand: [card('hearts', 6), card('clubs', 14)] },
          { id: 'B', hand: [card('hearts', 7), card('hearts', 8)] },
          { id: 'C', hand: [card('diamonds', 9), card('diamonds', 10)] },
        ],
        attackerId: 'A',
        defenderId: 'B',
        trumpSuit: 'spades',
        settings: {
          cheatingEnabled: true,
          cheatAttempts: 1,
          cheatNoticeScope: 'all',
          attackerScope: 'all',
        },
      });
      const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
      if (!r1.ok) throw new Error();
      const r2 = applyCommand(r1.state, {
        type: 'attack',
        playerId: 'A',
        cardId: 'clubs-14',
      });
      if (!r2.ok) throw new Error();
      const cheatEntryId = r2.state.table.attacks[1].id;
      // C (not the attacker) can notice.
      const rC = applyCommand(r2.state, {
        type: 'notice_cheat',
        playerId: 'C',
        attackEntryId: cheatEntryId,
      });
      expect(rC.ok).toBe(true);
      if (!rC.ok) return;
      const event = rC.events.find((e) => e.type === 'CheatNoticed');
      expect(event).toMatchObject({ succeeded: true, noticerId: 'C', cheaterId: 'A' });
    });

    it('rejects when the cheater themselves tries to notice', () => {
      const state = craftGame({
        players: [
          { id: 'A', hand: [card('hearts', 6), card('clubs', 14)] },
          { id: 'B', hand: [card('hearts', 7), card('hearts', 8)] },
        ],
        attackerId: 'A',
        defenderId: 'B',
        trumpSuit: 'spades',
        settings: {
          cheatingEnabled: true,
          cheatAttempts: 1,
          cheatNoticeScope: 'all',
        },
      });
      const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
      if (!r1.ok) throw new Error();
      const r2 = applyCommand(r1.state, {
        type: 'attack',
        playerId: 'A',
        cardId: 'clubs-14',
      });
      if (!r2.ok) throw new Error();
      const cheatEntryId = r2.state.table.attacks[1].id;
      const rA = applyCommand(r2.state, {
        type: 'notice_cheat',
        playerId: 'A',
        attackEntryId: cheatEntryId,
      });
      expect(rA.ok).toBe(false);
    });
  });
});
