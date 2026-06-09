import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import type { GameDetail, GameParticipantPublic } from '@durak/shared-types';

// `useSameComposition` hits the network — stub it so the smoke test stays
// hermetic. We assert both the populated and empty render paths through the
// vi.fn return value.
const sameCompositionMock = vi.fn();
vi.mock('./hooks', async () => {
  const actual = await vi.importActual<typeof import('./hooks')>('./hooks');
  return {
    ...actual,
    useSameComposition: () => sameCompositionMock(),
  };
});

import { GameDetailView } from './GameDetailView';

function participant(
  userId: string,
  place: number,
  overrides: Partial<GameParticipantPublic> = {},
): GameParticipantPublic {
  return {
    userId,
    nickname: `User ${userId}`,
    avatarUrl: null,
    seatIndex: place - 1,
    place,
    isWinner: place === 1,
    isLoser: false,
    muBefore: 25,
    sigmaBefore: 8,
    muAfter: 25 + (4 - place),
    sigmaAfter: 7.5,
    deltaDisplay: 4 - place,
    metrics: {
      attacksMade: 5,
      beatsMade: 3,
      translatesMade: 1,
      takesAsked: 0,
      cardsTaken: 0,
      boutsAttacked: 4,
      boutsDefended: 2,
      cheatAttemptedTotal: 0,
      cheatCaught: 0,
      cheatEscaped: 0,
      noticesIssued: 0,
      noticesCorrect: 0,
      noticesWrong: 0,
    },
    ...overrides,
  };
}

const baseDetail: GameDetail = {
  id: 'g-1',
  settings: {
    maxPlayers: 3,
    firstBoutLimit: 5,
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
  startedAt: '2026-06-03T14:00:00.000Z',
  finishedAt: '2026-06-03T14:24:00.000Z',
  durationSec: 1440,
  loserId: 'u3',
  totalBouts: 11,
  participants: [
    participant('u1', 1),
    participant('u2', 2),
    participant('u3', 3, { isLoser: true, deltaDisplay: -3 }),
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

describe('GameDetailView smoke', () => {
  it('renders header, podium, standings and the metrics list', () => {
    sameCompositionMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: { items: [], total: 0 },
      error: null,
    });
    renderWithProviders(<GameDetailView detail={baseDetail} />);

    // Header.
    expect(screen.getByTestId('game-detail-title')).toBeInTheDocument();

    // Podium has all three participants in their place buckets.
    expect(screen.getByTestId('podium-1')).toBeInTheDocument();
    expect(screen.getByTestId('podium-2')).toBeInTheDocument();
    expect(screen.getByTestId('podium-3')).toBeInTheDocument();

    // Standings rendered with the dурак badge on the loser.
    const standings = screen.getByTestId('game-detail-standings');
    expect(standings).toBeInTheDocument();
    expect(standings.textContent).toContain('Дурак');

    // Same-composition section shows the empty hint.
    expect(
      screen.getByText(/Игр таким же составом ещё не было/i),
    ).toBeInTheDocument();

    // Metrics list lazily renders the breakdown — click to expand the first
    // participant and check the metric grid appears.
    const toggle = screen.getByTestId('metrics-toggle-u1');
    fireEvent.click(toggle);
    expect(screen.getByTestId('metric-attacksMade')).toHaveTextContent('5');
  });

  it('renders past-games rows when same-composition returns items', () => {
    sameCompositionMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        items: [
          {
            id: 'g-prev-1',
            startedAt: '2026-05-30T10:00:00.000Z',
            endedAt: '2026-05-30T10:15:00.000Z',
            finishedAt: '2026-05-30T10:15:00.000Z',
            durationSec: 900,
            playerCount: 3,
            loserId: 'u2',
            totalBouts: 9,
            players: [
              {
                id: 'u1',
                nickname: 'User u1',
                avatarUrl: null,
                place: 1,
                isWinner: true,
                isLoser: false,
              },
              {
                id: 'u3',
                nickname: 'User u3',
                avatarUrl: null,
                place: 2,
                isWinner: false,
                isLoser: false,
              },
              {
                id: 'u2',
                nickname: 'User u2',
                avatarUrl: null,
                place: 3,
                isWinner: false,
                isLoser: true,
              },
            ],
          },
        ],
        total: 1,
      },
      error: null,
    });
    renderWithProviders(<GameDetailView detail={baseDetail} />);
    expect(
      screen.getByText(/Победил User u1/i),
    ).toBeInTheDocument();
  });

  it('renders rules toggle and expands when clicked', () => {
    sameCompositionMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: { items: [], total: 0 },
      error: null,
    });
    renderWithProviders(<GameDetailView detail={baseDetail} />);
    const toggle = screen.getByTestId('rules-toggle');
    expect(toggle).toBeInTheDocument();
    fireEvent.click(toggle);
    // Settings rows appear (label for "first turn" is shared with the in-game
    // settings modal i18n).
    expect(screen.getByText(/Первый ход/)).toBeInTheDocument();
  });
});
