import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import type { ClientGameState } from './types';

// The modal calls `useRematch` (mutation) which depends on api.post. We stub
// the api call so the smoke test stays hermetic — actual mutation behaviour
// is covered by the backend tests.
vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return {
    ...actual,
    rematch: vi.fn().mockResolvedValue({
      session: {
        sourceGameId: 'g-finished',
        initiator: { userId: 'u-me', nickname: 'Me', avatarUrl: null },
        expectedUserIds: ['u-me', 'u-opp'],
        accepted: ['u-me'],
        expiresAt: new Date(Date.now() + 90_000).toISOString(),
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
        composition: ['u-me', 'u-opp'],
        participants: [
          { userId: 'u-me', nickname: 'Me', avatarUrl: null },
          { userId: 'u-opp', nickname: 'Opponent', avatarUrl: null },
        ],
      },
    }),
  };
});

import { GameOverModal } from './GameOverModal';

const baseState: ClientGameState = {
  id: 'g-finished',
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
  status: 'game_over',
  trumpCard: null,
  trumpSuit: 'hearts',
  deckSize: 0,
  discardSize: 36,
  table: { attacks: [] },
  boutNumber: 12,
  loserPlayerId: 'u-opp',
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
      handSize: 0,
      isFinished: true,
      finishPlace: 1,
      isPassed: false,
      cheatAttemptsRemaining: 0,
    },
    {
      id: 'u-opp',
      nickname: 'Opponent',
      avatarUrl: null,
      cardBackId: 'classic-1',
      customCardBackUrl: null,
      handSize: 4,
      isFinished: false,
      isPassed: false,
      cheatAttemptsRemaining: 0,
    },
  ],
};

function renderWithProviders(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        {ui}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('GameOverModal', () => {
  it('shows the rematch button for participants', () => {
    renderWithProviders(
      <GameOverModal state={baseState} open onClose={() => undefined} />,
    );
    expect(screen.getByTestId('rematch-button')).toBeInTheDocument();
    expect(screen.getByTestId('rematch-button')).toHaveTextContent(
      /Ещё партию тем же составом/i,
    );
  });

  it('hides the rematch button when the viewer is a spectator', () => {
    // Spectators get an empty `myUserId` in the redacted snapshot — the modal
    // gates the CTA on it. We simulate the spectator case explicitly here.
    const spectatorState: ClientGameState = {
      ...baseState,
      myUserId: '',
      isSpectator: true,
    };
    renderWithProviders(
      <GameOverModal state={spectatorState} open onClose={() => undefined} />,
    );
    expect(screen.queryByTestId('rematch-button')).not.toBeInTheDocument();
  });
});
