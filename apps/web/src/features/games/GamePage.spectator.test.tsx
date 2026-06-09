import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import type { ClientGameState } from './types';

// Stub the WS bootstrap so jsdom doesn't try to connect.
vi.mock('./socket', () => ({
  gamesSocket: { on: vi.fn(), off: vi.fn(), once: vi.fn(), connected: false },
  useGameSocket: vi.fn(),
  connectGames: vi.fn(),
  disconnectGames: vi.fn(),
  subscribeGame: vi.fn(),
  sendGameCommand: vi.fn(),
  sendChatMessage: vi.fn(),
  sendChatReaction: vi.fn(),
  sendPauseVote: vi.fn(),
  sendPlayerReaction: vi.fn(),
  fetchChatHistory: vi.fn(async () => ({ messages: [] })),
}));

// Spectator state: viewer 'u-watcher' is not in `players`, isSpectator=true,
// no hand on any player.
const spectatorState: ClientGameState = {
  id: 'g1',
  myUserId: '__spectator__',
  isSpectator: true,
  settings: {
    maxPlayers: 2,
    firstBoutLimit: 6,
    attackerScope: 'all',
    exclusiveThrowIn: false,
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
  trumpCard: { kind: 'standard', id: 't1', suit: 'hearts', rank: 12 },
  trumpSuit: 'hearts',
  deckSize: 18,
  discardSize: 0,
  table: { attacks: [] },
  boutNumber: 1,
  loserPlayerId: null,
  currentAttackerId: 'u-a',
  currentDefenderId: 'u-b',
  passedPlayerIds: [],
  players: [
    {
      id: 'u-a',
      nickname: 'Alice',
      avatarUrl: null,
      cardBackId: 'classic-1',
      customCardBackUrl: null,
      handSize: 6,
      isFinished: false,
      isPassed: false,
      cheatAttemptsRemaining: 0,
    },
    {
      id: 'u-b',
      nickname: 'Bob',
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
      state: spectatorState,
      unseenEvents: [],
      acknowledgeEvents: vi.fn(),
      subscribeError: null,
      pauseInfo: null,
    }),
    useGameState: () => ({
      data: {
        state: spectatorState,
        recentEvents: [],
        unseenEvents: [],
        chatMessages: [],
        pauseInfo: null,
      },
      snapshotError: null,
      snapshotPending: false,
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
      refresh: vi.fn(async () => undefined),
    }),
    useGameReactions: () => ({ reactions: {}, send: vi.fn() }),
    usePauseVote: () => ({
      pauseInfo: null,
      myVote: null,
      vote: vi.fn(),
      isSubmitting: false,
    }),
  };
});

vi.mock('@/features/cardbacks/hooks', () => ({
  useCardBacks: () => ({ data: { items: [], randomOptionId: 'random' } }),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (state: { user: { id: string; nickname: string } | null }) => unknown) =>
    selector({ user: { id: 'u-watcher', nickname: 'Watcher' } }),
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

describe('GamePage spectator mode', () => {
  it('shows the spectator banner and hides hand / action bar / reaction button', async () => {
    renderWithProviders(<GamePage />);
    // Banner present.
    expect(await screen.findByTestId('spectator-banner')).toBeInTheDocument();
    // No player hand (the viewer has no cards).
    expect(screen.queryByTestId('player-hand')).not.toBeInTheDocument();
    // No reaction picker button (commands disabled).
    expect(screen.queryByTestId('open-reaction-picker')).not.toBeInTheDocument();
    // Players still rendered in the players row (clockwise from engine order).
    expect(screen.getAllByTestId('opponent-u-a').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('opponent-u-b').length).toBeGreaterThan(0);
  });
});
