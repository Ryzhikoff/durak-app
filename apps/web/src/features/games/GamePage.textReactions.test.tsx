import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import type { TextReaction } from '@durak/shared-types';
import type { ClientGameState } from './types';

const sendPlayerTextReactionMock = vi.fn(
  async (_gameId: string, _textReactionId: string) => ({ ok: true as const }),
);

vi.mock('./socket', () => ({
  gamesSocket: { on: vi.fn(), off: vi.fn(), once: vi.fn(), connected: false },
  useGameSocket: vi.fn(),
  connectGames: vi.fn(),
  disconnectGames: vi.fn(),
  subscribeGame: vi.fn(),
  sendGameCommand: vi.fn(),
  sendChatMessage: vi.fn(),
  sendChatReaction: vi.fn(),
  fetchChatHistory: vi.fn(async () => ({ messages: [] })),
  sendPauseVote: vi.fn(),
  sendPlayerReaction: vi.fn(async () => ({ ok: true as const })),
  sendPlayerTextReaction: (gameId: string, id: string) =>
    sendPlayerTextReactionMock(gameId, id),
}));

const fetchTextReactionsMock = vi.fn(async (): Promise<TextReaction[]> => [
  { id: 'r-1', text: 'Хороший ход!', sortOrder: 0 },
  { id: 'r-2', text: 'Ой-ой', sortOrder: 1 },
]);

vi.mock('./textReactionsApi', () => ({
  TEXT_REACTIONS_QUERY_KEY: ['text-reactions'] as const,
  fetchTextReactions: () => fetchTextReactionsMock(),
}));

const mockState: ClientGameState = {
  id: 'g1',
  myUserId: 'u-me',
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
    useGameCommand: () => async () => undefined,
  };
});

vi.mock('@/features/cardbacks/hooks', () => ({
  useCardBacks: () => ({ data: { items: [], randomOptionId: 'random' } }),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (state: { user: { id: string; nickname: string } | null }) => unknown) =>
    selector({ user: { id: 'u-me', nickname: 'Me' } }),
}));

import { GamePage } from './GamePage';

function renderWithProviders() {
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
          <Route path="/games/:id" element={<GamePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('GamePage text-reactions', () => {
  it('renders phrases in the picker and fires the WS mutation on click', async () => {
    sendPlayerTextReactionMock.mockClear();
    renderWithProviders();
    const user = userEvent.setup();
    const trigger = await screen.findByTestId('open-text-reaction-picker');
    await user.click(trigger);

    const button = await screen.findByTestId('text-reaction-r-1');
    expect(button.textContent).toContain('Хороший ход!');
    await user.click(button);

    expect(sendPlayerTextReactionMock).toHaveBeenCalledWith('g1', 'r-1');
  });

  it('shows the empty placeholder when the admin list is empty', async () => {
    fetchTextReactionsMock.mockImplementationOnce(async () => []);
    renderWithProviders();
    const user = userEvent.setup();
    const trigger = await screen.findByTestId('open-text-reaction-picker');
    await user.click(trigger);

    await screen.findByTestId('text-reaction-empty');
  });
});
