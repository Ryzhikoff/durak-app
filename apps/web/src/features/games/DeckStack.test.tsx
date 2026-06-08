/**
 * Smoke tests for `<DeckStack>` — the communal-deck visual rendered next to
 * the felt table. We don't validate pixel positions; we just check the right
 * mix of card backs / trump face is rendered for each deck-size regime.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import { DeckStack } from './DeckStack';
import type { Card as PlayingCardType } from './types';

// CardBackDisplay calls into the card-backs API via TanStack Query. Stub the
// hook to return empty so the component falls back to the neutral filler
// without hitting axios.
vi.mock('@/features/cardbacks/hooks', () => ({
  useCardBacks: () => ({ data: { items: [], randomOptionId: 'random' } }),
}));

const TRUMP_CARD: PlayingCardType = {
  kind: 'standard',
  id: 'trump',
  suit: 'hearts',
  rank: 12,
};

function renderDeckStack(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('DeckStack', () => {
  it('renders multiple face-down backs and the trump card when the deck has cards', () => {
    renderDeckStack(
      <DeckStack deckSize={24} trumpCard={TRUMP_CARD} trumpSuit="hearts" />,
    );
    expect(screen.getByTestId('deck-stack')).toBeInTheDocument();
    expect(screen.getByTestId('deck-trump-card')).toBeInTheDocument();
    // The visible stack should hold the capped 7 cards for any deckSize ≥ 12.
    const cards = screen.getByTestId('deck-stack-cards');
    expect(cards.children.length).toBe(7);
    // Count caption shows the real deck size, not the capped visible count.
    expect(screen.getByTestId('deck-stack-count')).toHaveTextContent('24');
  });

  it('renders only the faded trump card when the deck is empty', () => {
    renderDeckStack(
      <DeckStack deckSize={0} trumpCard={TRUMP_CARD} trumpSuit="hearts" />,
    );
    expect(screen.getByTestId('deck-stack')).toBeInTheDocument();
    expect(screen.getByTestId('deck-trump-card')).toBeInTheDocument();
    // No face-down backs.
    const cards = screen.getByTestId('deck-stack-cards');
    expect(cards.children.length).toBe(0);
    // Faded — opacity-40 class applied.
    const trump = screen.getByTestId('deck-trump-card');
    expect(trump.className).toMatch(/opacity-40/);
    // Empty caption.
    expect(screen.getByTestId('deck-stack-count').textContent).toMatch(
      /пуста/i,
    );
  });

  it('falls back to a suit glyph when the trump card is missing but suit is known', () => {
    renderDeckStack(
      <DeckStack deckSize={3} trumpCard={null} trumpSuit="spades" />,
    );
    expect(screen.queryByTestId('deck-trump-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('deck-trump-glyph')).toBeInTheDocument();
  });

  it('scales the visible stack with the deck size', () => {
    const { rerender } = renderDeckStack(
      <DeckStack deckSize={2} trumpCard={TRUMP_CARD} trumpSuit="hearts" />,
    );
    expect(screen.getByTestId('deck-stack-cards').children.length).toBe(2);

    rerender(
      <DeckStack deckSize={5} trumpCard={TRUMP_CARD} trumpSuit="hearts" />,
    );
    expect(screen.getByTestId('deck-stack-cards').children.length).toBe(3);

    rerender(
      <DeckStack deckSize={9} trumpCard={TRUMP_CARD} trumpSuit="hearts" />,
    );
    expect(screen.getByTestId('deck-stack-cards').children.length).toBe(5);
  });

  it('uses responsive card-size CSS vars so backs match PlayingCard md sizing', () => {
    // Regression: previously the stack hardcoded `cardW=56, cardH=80` so the
    // deck looked tiny next to the xl/2xl player hand. Now the dimensions are
    // CSS vars driven by Tailwind arbitrary classes on the root container, in
    // lock-step with PlayingCard `md` (`w-14 h-20 xl:w-24 xl:h-36 2xl:w-28 2xl:h-40`).
    renderDeckStack(
      <DeckStack deckSize={4} trumpCard={TRUMP_CARD} trumpSuit="hearts" />,
    );
    const root = screen.getByTestId('deck-stack');
    // Base (mobile) values.
    expect(root.className).toMatch(/\[--deck-card-w:3\.5rem\]/);
    expect(root.className).toMatch(/\[--deck-card-h:5rem\]/);
    // Desktop (xl) bump — matches PlayingCard md `xl:w-24 xl:h-36`.
    expect(root.className).toMatch(/xl:\[--deck-card-w:6rem\]/);
    expect(root.className).toMatch(/xl:\[--deck-card-h:9rem\]/);
    // 2xl bump — matches PlayingCard md `2xl:w-28 2xl:h-40`.
    expect(root.className).toMatch(/2xl:\[--deck-card-w:7rem\]/);
    expect(root.className).toMatch(/2xl:\[--deck-card-h:10rem\]/);
    // The stack-card boxes use those vars for their inline width/height.
    const cards = screen.getByTestId('deck-stack-cards');
    const firstBack = cards.children[0] as HTMLElement;
    expect(firstBack.style.width).toBe('var(--deck-card-w)');
    expect(firstBack.style.height).toBe('var(--deck-card-h)');
  });
});
