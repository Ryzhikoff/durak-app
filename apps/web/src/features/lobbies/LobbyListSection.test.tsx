import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';

// Avoid pulling the WS bootstrap in jsdom.
vi.mock('@/lib/socket', () => ({
  lobbiesSocket: { on: vi.fn(), off: vi.fn(), once: vi.fn(), connected: false },
  useLobbySocket: vi.fn(),
  connectLobbies: vi.fn(),
  disconnectLobbies: vi.fn(),
  SocketAckError: class SocketAckError extends Error {},
  emitWithAck: vi.fn(),
}));

// Stub REST.
vi.mock('./api', () => ({
  createLobby: vi.fn(),
  listLobbies: vi.fn(async () => []),
  fetchLobby: vi.fn(),
}));

import { LobbyListSection } from './LobbyListSection';

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

describe('LobbyListSection', () => {
  it('renders the empty state when there are no lobbies', async () => {
    renderWithProviders(<LobbyListSection />);

    expect(
      await screen.findByText(/Пока нет открытых лобби/i),
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Создать первое/i })).toBeInTheDocument();
  });
});
