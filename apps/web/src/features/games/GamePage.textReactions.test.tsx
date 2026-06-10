import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import type { TextReaction, UserTextReactionDTO } from '@durak/shared-types';
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

// Per-user customs — separate mock so each test can pin the list shape it
// wants (empty / customs-only / both layers).
const fetchMyTextReactionsMock = vi.fn(
  async (): Promise<UserTextReactionDTO[]> => [],
);

vi.mock('./userTextReactionsApi', () => ({
  ME_TEXT_REACTIONS_QUERY_KEY: ['me-text-reactions'] as const,
  fetchMyTextReactions: () => fetchMyTextReactionsMock(),
  createMyTextReaction: vi.fn(),
  deleteMyTextReaction: vi.fn(),
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

  it('shows the empty placeholder when BOTH the admin globals and the user customs are empty', async () => {
    fetchTextReactionsMock.mockImplementationOnce(async () => []);
    fetchMyTextReactionsMock.mockImplementationOnce(async () => []);
    renderWithProviders();
    const user = userEvent.setup();
    const trigger = await screen.findByTestId('open-text-reaction-picker');
    await user.click(trigger);

    await screen.findByTestId('text-reaction-empty');
  });

  it('renders BOTH sections with headers when admin globals and user customs are present', async () => {
    fetchMyTextReactionsMock.mockImplementationOnce(async () => [
      { id: 'my-1', text: 'Моя фраза', sortOrder: 0, createdAt: '2026-06-10T10:00:00.000Z' },
    ]);
    renderWithProviders();
    const user = userEvent.setup();
    const trigger = await screen.findByTestId('open-text-reaction-picker');
    await user.click(trigger);

    // Both section headers are present when both lists are non-empty.
    await screen.findByTestId('text-reaction-section-global');
    expect(screen.getByTestId('text-reaction-section-mine')).toBeInTheDocument();
    // Custom phrase appears with its `mine` testid prefix.
    expect(screen.getByTestId('text-reaction-mine-my-1').textContent).toContain(
      'Моя фраза',
    );
  });

  it('fires the WS mutation with the user-custom id when a custom phrase is picked', async () => {
    sendPlayerTextReactionMock.mockClear();
    fetchTextReactionsMock.mockImplementationOnce(async () => []);
    fetchMyTextReactionsMock.mockImplementationOnce(async () => [
      { id: 'my-1', text: 'Моя фраза', sortOrder: 0, createdAt: '2026-06-10T10:00:00.000Z' },
    ]);
    renderWithProviders();
    const user = userEvent.setup();
    const trigger = await screen.findByTestId('open-text-reaction-picker');
    await user.click(trigger);

    const button = await screen.findByTestId('text-reaction-mine-my-1');
    await user.click(button);

    // Server resolves the id regardless of source — the wire shape is the same.
    expect(sendPlayerTextReactionMock).toHaveBeenCalledWith('g1', 'my-1');
  });

  it('hides section headers when only one of the two layers is populated', async () => {
    // Only user customs, no admin globals → no section headers (single-section look).
    fetchTextReactionsMock.mockImplementationOnce(async () => []);
    fetchMyTextReactionsMock.mockImplementationOnce(async () => [
      { id: 'my-1', text: 'Solo', sortOrder: 0, createdAt: '2026-06-10T10:00:00.000Z' },
    ]);
    renderWithProviders();
    const user = userEvent.setup();
    const trigger = await screen.findByTestId('open-text-reaction-picker');
    await user.click(trigger);

    await screen.findByTestId('text-reaction-mine-my-1');
    expect(screen.queryByTestId('text-reaction-section-global')).toBeNull();
    expect(screen.queryByTestId('text-reaction-section-mine')).toBeNull();
  });
});
