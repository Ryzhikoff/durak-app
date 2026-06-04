import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import type { ClientGameState } from './types';

// Avoid pulling the WS bootstrap in jsdom.
vi.mock('./socket', () => ({
  gamesSocket: { on: vi.fn(), off: vi.fn(), once: vi.fn(), connected: false },
  useGameSocket: vi.fn(),
  connectGames: vi.fn(),
  disconnectGames: vi.fn(),
  subscribeGame: vi.fn(),
  sendGameCommand: vi.fn(),
}));

// We mock the useGameState hook so we can drive the UI without touching
// network/sockets. The hook returns the same shape the real implementation
// would after a successful snapshot + subscribe.
const mockState: ClientGameState = {
  id: 'g1',
  myUserId: 'u-me',
  settings: {
    maxPlayers: 2,
    firstBoutLimit: 6,
    attackerScope: 'all',
    cheatingEnabled: false,
    cheatAttempts: 0,
    cheatNoticeScope: 'defender_only',
    layoutOnRepeat: 'random',
    firstTurn: 'lowest_trump',
    deckSize: 36,
    jokers: false,
    turnTimer: null,
  },
  status: 'bout_attack',
  trumpCard: {
    kind: 'standard',
    id: 't1',
    suit: 'hearts',
    rank: 12,
  },
  trumpSuit: 'hearts',
  deckSize: 18,
  discardSize: 0,
  table: { attacks: [] },
  boutNumber: 1,
  loserPlayerId: null,
  currentAttackerId: 'u-me',
  currentDefenderId: 'u-opp',
  passedPlayerIds: [],
  players: [
    {
      id: 'u-me',
      nickname: 'Me',
      avatarUrl: null,
      cardBackId: 'classic-1',
      customCardBackUrl: null,
      handSize: 2,
      hand: [
        { kind: 'standard', id: 'c1', suit: 'spades', rank: 6 },
        { kind: 'standard', id: 'c2', suit: 'hearts', rank: 14 },
      ],
      isFinished: false,
      isPassed: false,
      cheatAttemptsRemaining: 0,
    },
    {
      id: 'u-opp',
      nickname: 'Opponent',
      avatarUrl: null,
      cardBackId: 'classic-1',
      customCardBackUrl: null,
      handSize: 6,
      isFinished: false,
      isPassed: false,
      cheatAttemptsRemaining: 0,
    },
  ],
};

vi.mock('./hooks', async () => {
  const actual = await vi.importActual<typeof import('./hooks')>('./hooks');
  return {
    ...actual,
    useGameState: () => ({
      data: { state: mockState, recentEvents: [], unseenEvents: [] },
      snapshotError: null,
      snapshotPending: false,
      subscribeError: null,
      acknowledgeEvents: vi.fn(),
    }),
    useGameCommand: () => async () => undefined,
  };
});

// Skip cardback API call by stubbing the hook.
vi.mock('@/features/cardbacks/hooks', () => ({
  useCardBacks: () => ({ data: { items: [], randomOptionId: 'random' } }),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (state: { user: { id: string; nickname: string } | null }) => unknown) =>
    selector({ user: { id: 'u-me', nickname: 'Me' } }),
}));

import { GamePage } from './GamePage';

function renderWithProviders(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={['/games/g1']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/games/:id" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('GamePage smoke', () => {
  it('renders the table, opponent, status bar and the player hand', async () => {
    renderWithProviders(<GamePage />);
    // Header chip + status bar both show the attacking banner.
    expect(
      (await screen.findAllByText(/Ходит\s+Me/i)).length,
    ).toBeGreaterThan(0);
    // Trump label is present.
    expect(screen.getByText(/Козырь/i)).toBeInTheDocument();
    // Table container rendered.
    expect(screen.getByTestId('game-table')).toBeInTheDocument();
    // New status bar replaces the old toast feed.
    expect(screen.getByTestId('game-status-bar')).toBeInTheDocument();
    // Opponent rendered.
    expect(screen.getByTestId('opponent-u-opp')).toBeInTheDocument();
    // Own hand rendered.
    expect(screen.getByTestId('player-hand')).toBeInTheDocument();
    // Each hand card is a draggable wrapper.
    expect(screen.getByTestId('hand-card-c1')).toBeInTheDocument();
    expect(screen.getByTestId('hand-card-c2')).toBeInTheDocument();
  });
});
