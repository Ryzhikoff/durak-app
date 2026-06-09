/**
 * Tests for `<PlayerHand>` — verifies the dynamic overlap layout so the hand
 * always fits the container width without horizontal scroll, regardless of how
 * many cards the player is holding.
 *
 * We don't render the whole game shell; we mock the auth store + DnD context
 * and rely on the `data-overlap` attribute the component exposes for layout
 * assertions (no jsdom layout engine to query computed styles otherwise).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import '@/lib/i18n';
import { PlayerHand } from './PlayerHand';
import type { Card } from './types';

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (state: { user: { handSortMode: string } | null }) => unknown) =>
    selector({ user: { handSortMode: 'power' } }),
}));

function card(id: string, suit: 'spades' | 'hearts' | 'diamonds' | 'clubs', rank: number): Card {
  return { kind: 'standard', id, suit, rank } as Card;
}

function makeHand(n: number): Card[] {
  const suits: Array<'spades' | 'hearts' | 'diamonds' | 'clubs'> = [
    'spades',
    'hearts',
    'diamonds',
    'clubs',
  ];
  return Array.from({ length: n }, (_, i) =>
    card(`c${i}`, suits[i % 4], 6 + (i % 9)),
  );
}

function renderHand(
  hand: Card[],
  opts: {
    isAttacker?: boolean;
    isDefender?: boolean;
    exclusiveLocked?: boolean;
  } = {},
) {
  return render(
    <DndContext>
      <PlayerHand
        hand={hand}
        trumpSuit="hearts"
        draggingCardId={null}
        isAttacker={opts.isAttacker}
        isDefender={opts.isDefender}
        exclusiveLocked={opts.exclusiveLocked}
      />
    </DndContext>,
  );
}

/**
 * jsdom doesn't implement ResizeObserver. We stub it so the component mounts
 * cleanly; we then drive recomputes by triggering the window resize handler
 * and inspecting the `data-overlap` attribute after a re-render.
 */
class MockResizeObserver {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element) {
    // Fire once with the current viewport width so the component's first
    // post-mount recompute matches the mocked viewport.
    const width = window.innerWidth;
    this.cb(
      [
        {
          target,
          contentRect: { width, height: 200, top: 0, left: 0, bottom: 200, right: width, x: 0, y: 0, toJSON: () => ({}) } as DOMRectReadOnly,
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  fireEvent(window, new Event('resize'));
}

describe('PlayerHand', () => {
  beforeEach(() => {
    globalThis.ResizeObserver = MockResizeObserver;
    setViewport(390); // iPhone 12 width
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the hand with minimum overlap when only a few cards are held', () => {
    renderHand(makeHand(4));
    const root = screen.getByTestId('player-hand');
    // 4 small cards on a 390px viewport easily fit at min overlap (12px).
    const overlap = Number(root.dataset.overlap);
    expect(overlap).toBe(12);
    expect(root.dataset.cardCount).toBe('4');
    // No horizontal scroll affordance — we clip with overflow-hidden.
    expect(root.className).toMatch(/overflow-hidden/);
    // Every card is rendered.
    expect(screen.getAllByTestId(/^hand-card-/).length).toBe(4);
  });

  it('packs a large hand into the viewport width without horizontal scroll', () => {
    renderHand(makeHand(14));
    const root = screen.getByTestId('player-hand');
    const overlap = Number(root.dataset.overlap);
    // 14 cards × 56px = 784px, viewport ≈ 390px-24px gutter = 366px available.
    // Required overlap = (784 - 366) / 13 ≈ 32.15px. Clamped within [12, 56-18=38].
    expect(overlap).toBeGreaterThanOrEqual(30);
    expect(overlap).toBeLessThanOrEqual(38);
    // Every card still rendered.
    expect(screen.getAllByTestId(/^hand-card-/).length).toBe(14);
  });

  it('clamps overlap to the max so even huge hands keep a visible corner', () => {
    // 30 cards is well past anything realistic but exercises the upper clamp.
    renderHand(makeHand(30));
    const root = screen.getByTestId('player-hand');
    const overlap = Number(root.dataset.overlap);
    // Upper clamp: cardW (56) - minVisible (18) = 38.
    expect(overlap).toBeLessThanOrEqual(38);
  });

  it('lifts cards on hover via -translate-y so the selected card is fully visible', () => {
    renderHand(makeHand(8));
    const firstCard = screen.getByTestId('hand-card-c0');
    // Hover-lift utility — keeps the lifted card above any overlapping siblings.
    expect(firstCard.className).toMatch(/hover:-translate-y-3/);
    // High z-index on hover ensures the lifted card paints above neighbours
    // even though sibling z-indices grow left-to-right.
    expect(firstCard.className).toMatch(/hover:!z-50/);
  });

  it('keeps Tailwind responsive overlap mapping in sync with PlayingCard md', () => {
    // On desktop viewport the felt-table is wide enough that small hands
    // breathe with an explicit gap (negative overlap). When the hand grows
    // the formula pulls neighbours closer; here with 4 cards there's plenty
    // of room so we expect the floor.
    setViewport(1440); // xl breakpoint
    renderHand(makeHand(4));
    const root = screen.getByTestId('player-hand');
    const overlap = Number(root.dataset.overlap);
    expect(overlap).toBe(-16);
  });

  it('renders the «Ваш ход» frame + attack badge when viewer is the attacker', () => {
    renderHand(makeHand(4), { isAttacker: true });
    const wrap = screen.getByTestId('player-hand-wrap');
    expect(wrap.dataset.myTurn).toBe('true');

    const badge = screen.getByTestId('your-turn-badge');
    expect(badge.dataset.turnRole).toBe('attack');
    // Attacker copy lives in the i18n bundle as `game.yourTurnAttack`.
    expect(badge.textContent).toMatch(/Ваш ход/);

    const frame = screen.getByTestId('your-turn-frame');
    // Emerald pulsing ring is what makes the frame impossible to miss.
    expect(frame.className).toMatch(/animate-pulse/);
    expect(frame.className).toMatch(/ring-emerald-400/);
    // Frame must NOT capture pointer events — would otherwise break DnD.
    expect(frame.className).toMatch(/pointer-events-none/);
  });

  it('renders the «Ваш ход» badge with defend copy when viewer is the defender', () => {
    renderHand(makeHand(4), { isDefender: true });
    const badge = screen.getByTestId('your-turn-badge');
    expect(badge.dataset.turnRole).toBe('defend');
    expect(badge.textContent).toMatch(/Ваш ход/);
  });

  it('does NOT render the «Ваш ход» frame/badge when viewer has no role', () => {
    renderHand(makeHand(4));
    const wrap = screen.getByTestId('player-hand-wrap');
    expect(wrap.dataset.myTurn).toBe('false');
    expect(screen.queryByTestId('your-turn-badge')).toBeNull();
    expect(screen.queryByTestId('your-turn-frame')).toBeNull();
  });

  it('dims the hand when exclusiveLocked is true', () => {
    renderHand(makeHand(4), { exclusiveLocked: true });
    const wrap = screen.getByTestId('player-hand-wrap');
    expect(wrap.dataset.exclusiveLocked).toBe('true');
    // opacity + cursor utility applied so the disabled state is visible.
    expect(wrap.className).toMatch(/opacity-50/);
    expect(wrap.className).toMatch(/cursor-not-allowed/);
  });

  it('does not dim the hand when exclusiveLocked is false (default)', () => {
    renderHand(makeHand(4));
    const wrap = screen.getByTestId('player-hand-wrap');
    expect(wrap.dataset.exclusiveLocked).toBe('false');
    expect(wrap.className).not.toMatch(/opacity-50/);
  });
});
