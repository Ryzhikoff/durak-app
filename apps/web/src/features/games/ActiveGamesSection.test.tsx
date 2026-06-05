import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import type { ActiveGameSummary } from './types';

// Avoid pulling the WS bootstrap in jsdom.
vi.mock('./socket', () => ({
  gamesSocket: { on: vi.fn(), off: vi.fn(), once: vi.fn(), connected: false },
  useGameSocket: vi.fn(),
  connectGames: vi.fn(),
  disconnectGames: vi.fn(),
}));

const items: ActiveGameSummary[] = [
  {
    gameId: 'game-1',
    startedAt: new Date().toISOString(),
    status: 'bout_attack',
    trumpSuit: 'hearts',
    deckSize: 18,
    boutNumber: 3,
    players: [
      {
        userId: 'ua',
        nickname: 'Alice',
        avatarUrl: null,
        handSize: 5,
        isAttacker: true,
        isDefender: false,
        isFinished: false,
      },
      {
        userId: 'ub',
        nickname: 'Bob',
        avatarUrl: null,
        handSize: 6,
        isAttacker: false,
        isDefender: true,
        isFinished: false,
      },
    ],
  },
];

vi.mock('./api', () => ({
  listActiveGames: vi.fn(async () => ({ items })),
}));

import { ActiveGamesSection } from './ActiveGamesSection';

function renderWithProviders(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={['/']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        {ui}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ActiveGamesSection', () => {
  it('renders each active game as a clickable card linking to /games/:id', async () => {
    renderWithProviders(<ActiveGamesSection />);
    const card = await screen.findByTestId('active-game-card-game-1');
    expect(card).toBeInTheDocument();
    expect(card.getAttribute('href')).toBe('/games/game-1');
    // Bout label and player names visible.
    expect(screen.getByText(/Раздача\s+3/i)).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
  });
});
