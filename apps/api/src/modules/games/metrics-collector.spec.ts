/**
 * Unit tests for the per-command metrics collector. We feed it
 * hand-crafted GameState + events tuples rather than driving the real engine
 * end-to-end — that lets us isolate every branch (illegal attack, illegal
 * beat, cheat-caught, cheat-escaped, normal flow).
 */

import { describe, expect, it } from 'vitest';
import type { AttackEntry, Card, DomainEvent, GameCommand, GameState } from '@durak/game-engine';
import { DEFAULT_LOBBY_SETTINGS } from '@durak/shared-types';
import { collectMetrics, type PendingIllegalEntry } from './metrics-collector';

function card(rank: number, suit: 'spades' | 'hearts' | 'diamonds' | 'clubs' = 'spades'): Card {
  return {
    kind: 'standard',
    id: `${suit}-${rank}`,
    suit,
    rank: rank as Card extends { rank: infer R } ? R : number,
  } as Card;
}

function makeEntry(
  id: string,
  c: Card,
  attackerId: string,
  beatenBy: Card | null = null,
): AttackEntry {
  return { id, card: c, beatenBy, attackerId };
}

function makeState(overrides: Partial<GameState> & { cheatingEnabled?: boolean }): GameState {
  const settings = {
    ...DEFAULT_LOBBY_SETTINGS,
    cheatingEnabled: overrides.cheatingEnabled ?? true,
  };
  return {
    id: 'g',
    settings,
    players: [
      { id: 'a', nickname: 'A', hand: [] },
      { id: 'b', nickname: 'B', hand: [] },
    ],
    currentAttackerIndex: 0,
    currentDefenderIndex: 1,
    trumpCard: null,
    trumpSuit: 'hearts',
    deck: [],
    discard: [],
    table: { attacks: [] },
    status: 'bout_attack',
    boutNumber: 1,
    initialDefenderHandSize: 6,
    finishedPlayers: [],
    loserPlayerId: null,
    passedPlayerIds: [],
    exclusiveLockReleased: false,
    cheatAttemptsRemaining: { a: 1, b: 1 },
    randSeed: 1,
    rngState: 1,
    nextEntryId: 1,
    ...overrides,
  } as GameState;
}

const DUMMY_CMD: GameCommand = { type: 'pass', playerId: 'a' };

describe('collectMetrics — counters', () => {
  it('counts an opening attack as attacksMade, no cheat flag', () => {
    const state = makeState({ cheatingEnabled: true });
    const events: DomainEvent[] = [
      { type: 'CardAttacked', playerId: 'a', entryId: 't1-1', card: card(10) },
    ];
    const out = collectMetrics({
      stateBefore: state,
      command: DUMMY_CMD,
      events,
      pendingIllegal: [],
    });
    expect(out.deltas).toEqual([{ userId: 'a', field: 'attacksMade', delta: 1 }]);
    expect(out.addIllegal).toEqual([]);
    expect(out.clearAllIllegal).toBe(false);
  });

  it('flags a rank-mismatched throw-in attack as illegal under cheating=true', () => {
    const state = makeState({
      table: { attacks: [makeEntry('t1-1', card(10), 'a')] },
      cheatingEnabled: true,
    });
    const events: DomainEvent[] = [
      { type: 'CardAttacked', playerId: 'a', entryId: 't1-2', card: card(7) },
    ];
    const out = collectMetrics({
      stateBefore: state,
      command: DUMMY_CMD,
      events,
      pendingIllegal: [],
    });
    expect(out.deltas).toContainEqual({ userId: 'a', field: 'attacksMade', delta: 1 });
    expect(out.deltas).toContainEqual({ userId: 'a', field: 'cheatAttemptedTotal', delta: 1 });
    expect(out.addIllegal).toEqual([{ entryId: 't1-2', cheaterId: 'a' }]);
  });

  it('does NOT flag rank-mismatched throws when cheating is disabled', () => {
    // Engine would have rejected this command outright with cheating off, but
    // the collector must be robust: never produce a cheat counter without the
    // setting.
    const state = makeState({
      table: { attacks: [makeEntry('t1-1', card(10), 'a')] },
      cheatingEnabled: false,
    });
    const events: DomainEvent[] = [
      { type: 'CardAttacked', playerId: 'a', entryId: 't1-2', card: card(7) },
    ];
    const out = collectMetrics({
      stateBefore: state,
      command: DUMMY_CMD,
      events,
      pendingIllegal: [],
    });
    expect(out.deltas).toEqual([{ userId: 'a', field: 'attacksMade', delta: 1 }]);
    expect(out.addIllegal).toEqual([]);
  });

  it('counts a legal beat and ignores it for cheat tracking', () => {
    const state = makeState({
      table: { attacks: [makeEntry('t1-1', card(8, 'spades'), 'a')] },
      trumpSuit: 'hearts',
      cheatingEnabled: true,
    });
    // 10 spades beats 8 spades (same suit, higher rank).
    const events: DomainEvent[] = [
      {
        type: 'CardBeaten',
        defenderId: 'b',
        attackEntryId: 't1-1',
        defenseCard: card(10, 'spades'),
      },
    ];
    const out = collectMetrics({
      stateBefore: state,
      command: DUMMY_CMD,
      events,
      pendingIllegal: [],
    });
    expect(out.deltas).toEqual([{ userId: 'b', field: 'beatsMade', delta: 1 }]);
    expect(out.addIllegal).toEqual([]);
  });

  it('flags an illegal beat as cheat under cheating=true', () => {
    const state = makeState({
      table: { attacks: [makeEntry('t1-1', card(10, 'spades'), 'a')] },
      trumpSuit: 'hearts',
      cheatingEnabled: true,
    });
    // 7 of clubs does NOT beat 10 of spades.
    const events: DomainEvent[] = [
      { type: 'CardBeaten', defenderId: 'b', attackEntryId: 't1-1', defenseCard: card(7, 'clubs') },
    ];
    const out = collectMetrics({
      stateBefore: state,
      command: DUMMY_CMD,
      events,
      pendingIllegal: [],
    });
    expect(out.deltas).toContainEqual({ userId: 'b', field: 'beatsMade', delta: 1 });
    expect(out.deltas).toContainEqual({ userId: 'b', field: 'cheatAttemptedTotal', delta: 1 });
    expect(out.addIllegal).toEqual([{ entryId: 't1-1', cheaterId: 'b' }]);
  });

  it('counts a translate for the from-player', () => {
    const state = makeState({});
    const events: DomainEvent[] = [
      { type: 'CardTranslated', fromPlayerId: 'b', newDefenderId: 'a', card: card(10) },
    ];
    const out = collectMetrics({
      stateBefore: state,
      command: DUMMY_CMD,
      events,
      pendingIllegal: [],
    });
    expect(out.deltas).toEqual([{ userId: 'b', field: 'translatesMade', delta: 1 }]);
    expect(out.addIllegal).toEqual([]);
  });

  it('counts DefenderTookCalled and CardsTaken separately', () => {
    const state = makeState({});
    const events: DomainEvent[] = [
      { type: 'DefenderTookCalled', defenderId: 'b' },
      { type: 'CardsTaken', defenderId: 'b', count: 4 },
    ];
    const out = collectMetrics({
      stateBefore: state,
      command: DUMMY_CMD,
      events,
      pendingIllegal: [],
    });
    expect(out.deltas).toContainEqual({ userId: 'b', field: 'takesAsked', delta: 1 });
    expect(out.deltas).toContainEqual({ userId: 'b', field: 'cardsTaken', delta: 4 });
  });
});

describe('collectMetrics — cheat lifecycle', () => {
  it('a successful CheatNoticed marks notice-correct + cheat-caught and drops the entry', () => {
    const state = makeState({});
    const pendingIllegal: PendingIllegalEntry[] = [{ entryId: 't1-2', cheaterId: 'a' }];
    const events: DomainEvent[] = [
      {
        type: 'CheatNoticed',
        noticerId: 'b',
        cheaterId: 'a',
        attackEntryId: 't1-2',
        succeeded: true,
      },
    ];
    const out = collectMetrics({ stateBefore: state, command: DUMMY_CMD, events, pendingIllegal });
    expect(out.deltas).toContainEqual({ userId: 'b', field: 'noticesIssued', delta: 1 });
    expect(out.deltas).toContainEqual({ userId: 'b', field: 'noticesCorrect', delta: 1 });
    expect(out.deltas).toContainEqual({ userId: 'a', field: 'cheatCaught', delta: 1 });
    expect(out.dropIllegalEntryIds).toEqual(['t1-2']);
  });

  it('a failed CheatNoticed marks notice-wrong only', () => {
    const state = makeState({});
    const events: DomainEvent[] = [
      {
        type: 'CheatNoticed',
        noticerId: 'b',
        cheaterId: 'a',
        attackEntryId: 't1-1',
        succeeded: false,
      },
    ];
    const out = collectMetrics({
      stateBefore: state,
      command: DUMMY_CMD,
      events,
      pendingIllegal: [],
    });
    expect(out.deltas).toContainEqual({ userId: 'b', field: 'noticesIssued', delta: 1 });
    expect(out.deltas).toContainEqual({ userId: 'b', field: 'noticesWrong', delta: 1 });
    expect(out.dropIllegalEntryIds).toEqual([]);
  });

  it('BoutEnded sweeps remaining pending-illegal entries as cheat-escaped', () => {
    // State before the closing command had attacker=a, defender=b; that's
    // who gets the bouts-attacked/defended credit.
    const state = makeState({ currentAttackerIndex: 0, currentDefenderIndex: 1 });
    const pendingIllegal: PendingIllegalEntry[] = [
      { entryId: 't1-1', cheaterId: 'a' },
      { entryId: 't1-2', cheaterId: 'a' },
    ];
    const events: DomainEvent[] = [{ type: 'BoutEnded', outcome: 'beaten', boutNumber: 1 }];
    const out = collectMetrics({ stateBefore: state, command: DUMMY_CMD, events, pendingIllegal });
    expect(out.deltas).toContainEqual({ userId: 'a', field: 'cheatEscaped', delta: 1 });
    // Two illegal entries -> two escape counts on the SAME cheater = +2 net.
    const escaped = out.deltas.filter((d) => d.userId === 'a' && d.field === 'cheatEscaped');
    expect(escaped.reduce((sum, d) => sum + d.delta, 0)).toBe(2);
    expect(out.clearAllIllegal).toBe(true);
    expect(out.deltas).toContainEqual({ userId: 'a', field: 'boutsAttacked', delta: 1 });
    expect(out.deltas).toContainEqual({ userId: 'b', field: 'boutsDefended', delta: 1 });
  });

  it('BoutEnded does not double-count an entry that was caught in the same command', () => {
    const state = makeState({});
    const pendingIllegal: PendingIllegalEntry[] = [{ entryId: 't1-1', cheaterId: 'a' }];
    const events: DomainEvent[] = [
      {
        type: 'CheatNoticed',
        noticerId: 'b',
        cheaterId: 'a',
        attackEntryId: 't1-1',
        succeeded: true,
      },
      { type: 'BoutEnded', outcome: 'beaten', boutNumber: 1 },
    ];
    const out = collectMetrics({ stateBefore: state, command: DUMMY_CMD, events, pendingIllegal });
    // Caught, not escaped.
    expect(out.deltas).toContainEqual({ userId: 'a', field: 'cheatCaught', delta: 1 });
    expect(out.deltas.some((d) => d.field === 'cheatEscaped')).toBe(false);
  });
});

describe('collectMetrics — cheats-off scenarios', () => {
  it('a clean translate-pass bout produces no cheat metrics', () => {
    const state = makeState({ cheatingEnabled: false });
    const events: DomainEvent[] = [
      { type: 'CardAttacked', playerId: 'a', entryId: 't1-1', card: card(10) },
      { type: 'CardTranslated', fromPlayerId: 'b', newDefenderId: 'a', card: card(10, 'hearts') },
    ];
    const out = collectMetrics({
      stateBefore: state,
      command: DUMMY_CMD,
      events,
      pendingIllegal: [],
    });
    expect(out.deltas).toEqual([
      { userId: 'a', field: 'attacksMade', delta: 1 },
      { userId: 'b', field: 'translatesMade', delta: 1 },
    ]);
    expect(out.addIllegal).toEqual([]);
  });
});
