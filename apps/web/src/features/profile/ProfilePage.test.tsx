import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import type {
  CardBacksListResponse,
  GameSummary,
  PublicProfile,
} from '@durak/shared-types';

const empty: PublicProfile = {
  id: 'someone-else',
  nickname: 'Соперник',
  avatarUrl: null,
  isAdmin: false,
  rating: 1234,
  trueskill: { mu: 25, sigma: 8.333 },
  stats: {
    gamesPlayed: 0,
    wins: 0,
    lastPlaces: 0,
    firstPlaceRate: 0,
    lastPlaceRate: 0,
    cheatAttempts: 0,
    cheatCaught: 0,
  },
  lastGames: [],
  cardBackId: 'classic-1',
  randomCardBack: false,
  customCardBackUrl: null,
};

const populatedGames: GameSummary[] = [
  {
    id: 'game-1',
    startedAt: '2025-06-01T12:00:00.000Z',
    endedAt: '2025-06-01T12:07:00.000Z',
    finishedAt: '2025-06-01T12:07:00.000Z',
    durationSec: 420,
    playerCount: 3,
    loserId: 'someone-else',
    totalBouts: 14,
    players: [
      {
        id: 'someone-else',
        nickname: 'Соперник',
        avatarUrl: null,
        place: 3,
        isWinner: false,
        isLoser: true,
      },
      {
        id: 'pl-2',
        nickname: 'Победитель',
        avatarUrl: null,
        place: 1,
        isWinner: true,
        isLoser: false,
      },
      {
        id: 'pl-3',
        nickname: 'Второй',
        avatarUrl: null,
        place: 2,
        isWinner: false,
        isLoser: false,
      },
    ],
  },
];

const populated: PublicProfile = {
  ...empty,
  stats: {
    gamesPlayed: 10,
    wins: 3,
    lastPlaces: 2,
    firstPlaceRate: 0.3,
    lastPlaceRate: 0.2,
    cheatAttempts: 4,
    cheatCaught: 1,
    cheatEscaped: 3,
    noticesIssued: 2,
    noticesCorrect: 1,
    noticesWrong: 1,
    translatesMade: 5,
    takesAsked: 6,
    cardsTaken: 17,
  },
  lastGames: populatedGames,
};

const fetchPublicProfileMock = vi.fn(
  async (_id: string): Promise<PublicProfile> => empty,
);

vi.mock('./api', () => ({
  fetchPublicProfile: (id: string) => fetchPublicProfileMock(id),
  updateMe: vi.fn(),
  uploadAvatar: vi.fn(),
  deleteAvatar: vi.fn(),
  uploadCardBack: vi.fn(),
  deleteCardBack: vi.fn(),
}));

vi.mock('@/features/cardbacks/api', () => ({
  fetchCardBacks: vi.fn(
    async (): Promise<CardBacksListResponse> => ({
      items: [],
      randomOptionId: '__random__',
    }),
  ),
}));

import { ProfilePage } from './ProfilePage';

function renderWithProviders(initialPath: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[initialPath]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/u/:id" element={<ProfilePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProfilePage (public view)', () => {
  it('renders nickname, rating and empty stats state', async () => {
    fetchPublicProfileMock.mockResolvedValueOnce(empty);
    renderWithProviders('/u/someone-else');

    expect(
      await screen.findByRole('heading', { name: 'Соперник' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1234')).toBeInTheDocument();
    expect(
      await screen.findByText(/Статистика появится после первых игр/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Игр ещё нет/i)).toBeInTheDocument();
    // Settings section is for own profile only — should NOT be visible here.
    expect(screen.queryByText(/Настройки профиля/i)).not.toBeInTheDocument();
  });

  it('renders full stats grid and last-games card when populated', async () => {
    fetchPublicProfileMock.mockResolvedValueOnce(populated);
    renderWithProviders('/u/someone-else');

    // Empty-state copy disappears once gamesPlayed > 0.
    expect(
      await screen.findByText(/Игр сыграно/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Статистика появится после первых игр/i),
    ).not.toBeInTheDocument();

    // Section headers.
    expect(screen.getByText(/^Игры$/)).toBeInTheDocument();
    expect(screen.getByText(/Игровые действия/i)).toBeInTheDocument();
    expect(screen.getByText(/Жульничество/i)).toBeInTheDocument();

    // Specific metric labels.
    expect(screen.getByText(/Переводы/i)).toBeInTheDocument();
    expect(screen.getByText(/Карт забрано/i)).toBeInTheDocument();
    expect(screen.getByText(/Поймали/)).toBeInTheDocument();

    // Last-games card has the winner nickname and the duration label.
    expect(screen.getByText(/Победитель: Победитель/)).toBeInTheDocument();
    expect(screen.getByText(/7:00/)).toBeInTheDocument();
  });
});
