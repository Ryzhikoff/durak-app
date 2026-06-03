import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import type { GameListResponse, RatingListResponse } from '@durak/shared-types';

// Mock both networked feature APIs so the page can render in isolation.
vi.mock('./api', () => ({
  listRating: vi.fn(
    async (): Promise<RatingListResponse> => ({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    }),
  ),
}));

vi.mock('@/features/games/api', () => ({
  listGames: vi.fn(
    async (): Promise<GameListResponse> => ({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    }),
  ),
  fetchGame: vi.fn(),
}));

// Bypass WS bootstrap so the rating page renders in jsdom.
vi.mock('@/features/lobbies/api', () => ({
  createLobby: vi.fn(),
  listLobbies: vi.fn(async () => []),
  fetchLobby: vi.fn(),
}));
vi.mock('@/lib/socket', () => ({
  lobbiesSocket: { on: vi.fn(), off: vi.fn(), once: vi.fn(), connected: false },
  useLobbySocket: vi.fn(),
  connectLobbies: vi.fn(),
  disconnectLobbies: vi.fn(),
  SocketAckError: class SocketAckError extends Error {},
  emitWithAck: vi.fn(),
}));

import { RatingPage } from './RatingPage';

function renderWithProviders(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={['/']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        {ui}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RatingPage', () => {
  it('renders the rating title and both empty states', async () => {
    renderWithProviders(<RatingPage />);

    expect(
      await screen.findByRole('heading', { name: /Рейтинг$/i }),
    ).toBeInTheDocument();

    expect(await screen.findByText(/Пока никто не играл/i)).toBeInTheDocument();
    expect(await screen.findByText(/Игр ещё нет/i)).toBeInTheDocument();
  });
});
