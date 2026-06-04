/**
 * Switch tests for `<GamePage>` — drives the discriminated `useGame` hook
 * through every public `kind` and asserts the right view renders.
 *
 * The "live" kind has its own deep smoke test in `GamePage.test.tsx`; here
 * we cover the new finished/not_found/loading/error branches added in
 * Phase 7B.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import type { GameDetail } from '@durak/shared-types';
import type { UseGameResult } from './hooks';

vi.mock('./socket', () => ({
  gamesSocket: { on: vi.fn(), off: vi.fn(), once: vi.fn(), connected: false },
  useGameSocket: vi.fn(),
  connectGames: vi.fn(),
  disconnectGames: vi.fn(),
  subscribeGame: vi.fn(),
  sendGameCommand: vi.fn(),
}));

let nextResult: UseGameResult = { kind: 'loading' };

vi.mock('./hooks', async () => {
  const actual = await vi.importActual<typeof import('./hooks')>('./hooks');
  return {
    ...actual,
    useGame: () => nextResult,
    useSameComposition: () => ({
      isPending: false,
      isError: false,
      data: { items: [], total: 0 },
      error: null,
    }),
    useGameState: () => ({
      data: undefined,
      snapshotError: null,
      snapshotPending: true,
      subscribeError: null,
      acknowledgeEvents: vi.fn(),
    }),
    useGameCommand: () => async () => undefined,
    useGameChat: () => ({
      messages: [],
      send: vi.fn(),
      react: vi.fn(),
      isSending: false,
      unreadCount: 0,
      markAllRead: vi.fn(),
      refresh: vi.fn(),
    }),
  };
});

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (
    selector: (state: { user: { id: string; nickname: string } | null }) => unknown,
  ) => selector({ user: { id: 'u-me', nickname: 'Me' } }),
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

const finishedDetail: GameDetail = {
  id: 'g1',
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
  startedAt: '2026-05-01T12:00:00.000Z',
  finishedAt: '2026-05-01T12:10:00.000Z',
  durationSec: 600,
  loserId: 'u2',
  totalBouts: 7,
  participants: [
    {
      userId: 'u1',
      nickname: 'Winner',
      avatarUrl: null,
      seatIndex: 0,
      place: 1,
      isWinner: true,
      isLoser: false,
      muBefore: 25,
      sigmaBefore: 8,
      muAfter: 26,
      sigmaAfter: 7.5,
      deltaDisplay: 2,
      metrics: {
        attacksMade: 5,
        beatsMade: 3,
        translatesMade: 0,
        takesAsked: 0,
        cardsTaken: 0,
        boutsAttacked: 3,
        boutsDefended: 1,
        cheatAttemptedTotal: 0,
        cheatCaught: 0,
        cheatEscaped: 0,
        noticesIssued: 0,
        noticesCorrect: 0,
        noticesWrong: 0,
      },
    },
    {
      userId: 'u2',
      nickname: 'Loser',
      avatarUrl: null,
      seatIndex: 1,
      place: 2,
      isWinner: false,
      isLoser: true,
      muBefore: 25,
      sigmaBefore: 8,
      muAfter: 24,
      sigmaAfter: 7.5,
      deltaDisplay: -2,
      metrics: {
        attacksMade: 3,
        beatsMade: 2,
        translatesMade: 0,
        takesAsked: 1,
        cardsTaken: 3,
        boutsAttacked: 1,
        boutsDefended: 3,
        cheatAttemptedTotal: 0,
        cheatCaught: 0,
        cheatEscaped: 0,
        noticesIssued: 0,
        noticesCorrect: 0,
        noticesWrong: 0,
      },
    },
  ],
};

describe('GamePage discriminated switch', () => {
  it('shows the spinner while loading', () => {
    nextResult = { kind: 'loading' };
    renderWithProviders(<GamePage />);
    // <Spinner> renders a role="status" element.
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the NotFound card on 404', () => {
    nextResult = { kind: 'not_found' };
    renderWithProviders(<GamePage />);
    expect(screen.getByText(/Игра не найдена/i)).toBeInTheDocument();
  });

  it('renders the GameDetailView when finished', () => {
    nextResult = { kind: 'finished', detail: finishedDetail };
    renderWithProviders(<GamePage />);
    expect(screen.getByTestId('game-detail-view')).toBeInTheDocument();
    expect(screen.getByTestId('game-detail-title')).toBeInTheDocument();
  });

  it('renders an error alert on error', () => {
    nextResult = { kind: 'error', error: new Error('boom') };
    renderWithProviders(<GamePage />);
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });
});
