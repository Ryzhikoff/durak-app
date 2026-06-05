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
});
