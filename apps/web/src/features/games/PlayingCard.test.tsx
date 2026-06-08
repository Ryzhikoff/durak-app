import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FaceCardAsset } from '@durak/shared-types';
import type { Card } from './types';

// The hook fetches from /face-cards on mount; we mock the underlying API so
// the test never goes through axios/network.
const fetchFaceCardsMock = vi.fn(async (): Promise<FaceCardAsset[]> => []);

vi.mock('./faceCardsApi', () => ({
  fetchFaceCards: () => fetchFaceCardsMock(),
}));

import { PlayingCard } from './PlayingCard';

function renderCard(card: Card) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <PlayingCard card={card} />
    </QueryClientProvider>,
  );
}

type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';

const stdCard = (rank: number, suit: Suit = 'spades'): Card => ({
  kind: 'standard',
  id: `${rank}-${suit}`,
  // Engine's Rank union spans 2..14; cast keeps the test fixtures terse.
  rank: rank as 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14,
  suit,
});

describe('PlayingCard', () => {
  beforeEach(() => {
    fetchFaceCardsMock.mockReset();
    fetchFaceCardsMock.mockImplementation(async () => []);
  });

  it('renders 6 pips for a 6', () => {
    renderCard(stdCard(6, 'spades'));
    expect(screen.getAllByTestId('card-pip')).toHaveLength(6);
  });

  it('renders 10 pips for a 10', () => {
    renderCard(stdCard(10, 'hearts'));
    expect(screen.getAllByTestId('card-pip')).toHaveLength(10);
  });

  it('renders the centred suit glyph for an Ace', () => {
    renderCard(stdCard(14, 'diamonds'));
    expect(screen.getByTestId('card-ace-symbol')).toBeInTheDocument();
    expect(screen.queryAllByTestId('card-pip')).toHaveLength(0);
  });

  it('falls back to the default SVG silhouette for a Jack when no custom asset is uploaded', () => {
    renderCard(stdCard(11, 'spades'));
    expect(screen.getByTestId('card-face-svg-jack')).toBeInTheDocument();
    expect(screen.queryByTestId('card-face-image')).toBeNull();
  });

  it('falls back to the default silhouette for a Queen and a King', () => {
    const { unmount } = renderCard(stdCard(12, 'clubs'));
    expect(screen.getByTestId('card-face-svg-queen')).toBeInTheDocument();
    unmount();
    renderCard(stdCard(13, 'hearts'));
    expect(screen.getByTestId('card-face-svg-king')).toBeInTheDocument();
  });

  it('renders the admin-uploaded image when a face-card asset exists for the slot', async () => {
    fetchFaceCardsMock.mockImplementationOnce(async () => [
      { rank: 'jack', suit: 'spades', url: '/uploads/face-cards/jack-spades.webp?v=1' },
    ]);
    renderCard(stdCard(11, 'spades'));
    const img = await screen.findByTestId('card-face-image');
    expect(img).toHaveAttribute('src', '/uploads/face-cards/jack-spades.webp?v=1');
  });

  it('ignores an uploaded asset that targets a different suit', async () => {
    fetchFaceCardsMock.mockImplementationOnce(async () => [
      { rank: 'jack', suit: 'hearts', url: '/uploads/face-cards/jack-hearts.webp?v=1' },
    ]);
    renderCard(stdCard(11, 'spades'));
    // Allow the query to settle and the effect to re-run.
    expect(await screen.findByTestId('card-face-svg-jack')).toBeInTheDocument();
    expect(screen.queryByTestId('card-face-image')).toBeNull();
  });
});
