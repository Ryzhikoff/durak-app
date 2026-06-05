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
    useGame: () => ({
      kind: 'live' as const,
      state: mockState,
      unseenEvents: [],
      acknowledgeEvents: vi.fn(),
      subscribeError: null,
    }),
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
  it('renders the info-strip, players row, table and the player hand', async () => {
    renderWithProviders(<GamePage />);
    // The "Ходит Me" line appears in the info-strip status pill AND the
    // status-bar fallback below the table — so we expect ≥1 occurrence.
    expect(
      (await screen.findAllByText(/Ходит\s+Me/i)).length,
    ).toBeGreaterThan(0);
    // Info-strip groups bout / status / discard / buttons. Trump glyph + deck
    // count moved into the dedicated `DeckStack` block (rendered separately
    // alongside the felt table on desktop, above the players row on mobile).
    expect(screen.getByTestId('game-info-strip')).toBeInTheDocument();
    // Deck stack rendered with the trump card visible (mock has deckSize=18
    // and a hearts queen trump card).
    expect(screen.getAllByTestId('deck-stack').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('deck-trump-card').length).toBeGreaterThan(0);
    // Table container rendered.
    expect(screen.getByTestId('game-table')).toBeInTheDocument();
    // Status bar still present below the table.
    expect(screen.getByTestId('game-status-bar')).toBeInTheDocument();
    // Players row holds opponents only — the viewer is not listed there.
    // The same opponent chip is rendered in two containers — the mobile
    // players-row (xl:hidden) AND the desktop radial-seat layout — so we
    // expect at least one match and exactly zero self-chips.
    expect(screen.getByTestId('players-row')).toBeInTheDocument();
    expect(screen.getAllByTestId('opponent-u-opp').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('player-self-u-me')).not.toBeInTheDocument();
    // Own hand rendered.
    expect(screen.getByTestId('player-hand')).toBeInTheDocument();
    // Each hand card is a draggable wrapper.
    expect(screen.getByTestId('hand-card-c1')).toBeInTheDocument();
    expect(screen.getByTestId('hand-card-c2')).toBeInTheDocument();
  });
});
