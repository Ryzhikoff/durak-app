import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/state/reducers.js';
import { closeBoutBeaten, closeBoutTaken, refillHands } from '../src/state/transitions.js';
import { card, craftGame } from '../src/_testing/fixtures.js';

describe('refill order', () => {
  it('after take, the defender does NOT draw but the attacker and others do', () => {
    // Defender (B) takes a single attack card. Then refills happen with B
    // explicitly skipped. The deck has just enough cards to refill A and C
    // to STANDARD_HAND_SIZE (=6) but leave the defender's hand alone.
    const deckCards = [
      // bottom (trump) at index 0; top of deck = end of array
      card('clubs', 14),
      card('clubs', 13),
      card('clubs', 12),
      card('clubs', 11),
      card('hearts', 14),
      card('hearts', 13),
      card('hearts', 12),
      card('hearts', 11),
      card('diamonds', 14),
      card('diamonds', 13),
      card('diamonds', 12),
      card('diamonds', 11),
    ];
    const state = craftGame({
      players: [
        // A starts with 1 card so refill draws 5 from top of deck.
        { id: 'A', hand: [card('hearts', 6)] },
        // B (defender) takes the single attack card -> hand = 1 + 1 = 2; no
        // refill expected (skipped).
        { id: 'B', hand: [card('clubs', 6)] },
        // C starts with 1 card; expects to refill to 6.
        { id: 'C', hand: [card('diamonds', 6)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      deck: deckCards,
      settings: { cheatingEnabled: false, attackerScope: 'all' },
    });
    const r1 = applyCommand(state, { type: 'attack', playerId: 'A', cardId: 'hearts-6' });
    if (!r1.ok) throw new Error();
    const r2 = applyCommand(r1.state, { type: 'take', playerId: 'B' });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const A = r2.state.players.find((p) => p.id === 'A')!;
    const B = r2.state.players.find((p) => p.id === 'B')!;
    const C = r2.state.players.find((p) => p.id === 'C')!;
    // Defender keeps the original card + the picked-up attack card.
    expect(B.hand.map((c) => c.id).sort()).toEqual(['clubs-6', 'hearts-6']);
    expect(A.hand.length).toBe(6);
    expect(C.hand.length).toBe(6);
    // The PlayersDrew event lists only A and C; B is not in there.
    const drew = r2.events.find((e) => e.type === 'PlayersDrew');
    expect(drew).toBeDefined();
    if (drew && drew.type === 'PlayersDrew') {
      const ids = drew.draws.map((d) => d.playerId).sort();
      expect(ids).toEqual(['A', 'C']);
    }
  });

  it('refillHands(skipPlayerId) excludes the skipped player from the order', () => {
    const deckCards = [
      card('clubs', 14),
      card('clubs', 13),
      card('clubs', 12),
      card('clubs', 11),
      card('clubs', 10),
      card('clubs', 9),
    ];
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6)] },
        { id: 'B', hand: [card('hearts', 7)] },
        { id: 'C', hand: [card('hearts', 8)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      deck: deckCards,
      settings: { cheatingEnabled: false },
    });
    const { state: refilled, event } = refillHands(state, 'A', 'B', { skipPlayerId: 'B' });
    expect(event.type).toBe('PlayersDrew');
    if (event.type !== 'PlayersDrew') return;
    const ids = event.draws.map((d) => d.playerId);
    expect(ids).not.toContain('B');
    const B = refilled.players.find((p) => p.id === 'B')!;
    expect(B.hand.map((c) => c.id)).toEqual(['hearts-7']);
  });
});

describe('PlayerOut events', () => {
  it('emits PlayerOut when a player ends a bout with empty hand and empty deck', () => {
    // No deck, A defends with their only card and beats it; with cheating
    // disabled the engine auto-closes the bout on the last beat — A is
    // finished (hand = 0, deck = 0) and the game ends right there.
    const state = craftGame({
      players: [
        // A (defender) holds one trump.
        { id: 'A', hand: [card('spades', 14)] },
        // B (attacker) opens with a 6, plus a spare so they survive.
        { id: 'B', hand: [card('hearts', 6), card('hearts', 7), card('hearts', 8)] },
      ],
      attackerId: 'B',
      defenderId: 'A',
      trumpSuit: 'spades',
      deck: [],
      settings: { cheatingEnabled: false },
    });
    const r1 = applyCommand(state, { type: 'attack', playerId: 'B', cardId: 'hearts-6' });
    if (!r1.ok) throw new Error();
    const r2 = applyCommand(r1.state, {
      type: 'beat',
      playerId: 'A',
      attackEntryId: r1.state.table.attacks[0].id,
      defenseCardId: 'spades-14',
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    // GameEnded since only one player remains with cards.
    const playerOut = r2.events.find((e) => e.type === 'PlayerOut');
    expect(playerOut).toBeDefined();
    if (playerOut && playerOut.type === 'PlayerOut') {
      expect(playerOut.playerId).toBe('A');
      expect(playerOut.place).toBe(1);
    }
  });
});

describe('draw scenario', () => {
  it('two players go out in the same bout closure → both placed, loserId=null', () => {
    // 2-player setup: both have a single card, deck empty. Attacker plays
    // their last card, defender beats with their last card. With cheating
    // disabled the engine auto-closes the bout on the final beat — both
    // hands end up empty after the close, the game ends as a draw.
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 6)] },
        { id: 'B', hand: [card('hearts', 10)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      deck: [],
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
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.status).toBe('game_over');
    const ended = r2.events.find((e) => e.type === 'GameEnded');
    expect(ended).toBeDefined();
    if (ended && ended.type === 'GameEnded') {
      expect(ended.loserId).toBeNull();
      const placedIds = ended.placements.map((p) => p.playerId).sort();
      expect(placedIds).toEqual(['A', 'B']);
    }
  });
});

describe('closeBout helpers (smoke)', () => {
  it('closeBoutBeaten and closeBoutTaken can be invoked directly with a crafted state', () => {
    // Smoke test to make sure the helpers are exported via the public API
    // and accept a raw GameState. Functional behaviour is covered by the
    // higher-level reducer tests.
    const state = craftGame({
      players: [
        { id: 'A', hand: [card('hearts', 7), card('hearts', 8)] },
        { id: 'B', hand: [card('hearts', 9)] },
      ],
      attackerId: 'A',
      defenderId: 'B',
      trumpSuit: 'spades',
      deck: [card('clubs', 14), card('clubs', 13)],
      settings: { cheatingEnabled: false },
    });
    const beaten = closeBoutBeaten(state);
    expect(beaten.state.boutNumber).toBe(2);
    const taken = closeBoutTaken(state);
    expect(taken.state.boutNumber).toBe(2);
  });
});
