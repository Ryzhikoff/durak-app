import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import type { CardBacksListResponse, PublicProfile } from '@durak/shared-types';

vi.mock('./api', () => ({
  fetchPublicProfile: vi.fn(
    async (): Promise<PublicProfile> => ({
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
    }),
  ),
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
});
