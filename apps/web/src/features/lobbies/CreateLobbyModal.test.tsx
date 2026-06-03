import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';

vi.mock('@/lib/socket', () => ({
  lobbiesSocket: { on: vi.fn(), off: vi.fn(), once: vi.fn(), connected: false },
  useLobbySocket: vi.fn(),
  connectLobbies: vi.fn(),
  disconnectLobbies: vi.fn(),
  SocketAckError: class SocketAckError extends Error {},
  emitWithAck: vi.fn(),
}));
vi.mock('./api', () => ({
  createLobby: vi.fn(),
  listLobbies: vi.fn(async () => []),
  fetchLobby: vi.fn(),
}));

import { CreateLobbyModal } from './CreateLobbyModal';

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

describe('CreateLobbyModal', () => {
  it('renders every settings group with sensible defaults and the submit button enabled', () => {
    renderWithProviders(<CreateLobbyModal open onClose={() => undefined} />);

    // Title rendered.
    expect(screen.getByRole('heading', { name: /Новое лобби/i })).toBeInTheDocument();

    // Every key field label is present.
    expect(screen.getByText(/Максимум игроков/i)).toBeInTheDocument();
    expect(screen.getByText(/Максимум карт в первом отбое/i)).toBeInTheDocument();
    expect(screen.getByText(/Кто может подкидывать/i)).toBeInTheDocument();
    expect(screen.getByText(/Мухляж разрешён/i)).toBeInTheDocument();
    expect(screen.getByText(/Рассадка после партии/i)).toBeInTheDocument();
    expect(screen.getByText(/Первый ход/i)).toBeInTheDocument();
    expect(screen.getByText(/Размер колоды/i)).toBeInTheDocument();
    expect(screen.getByText(/Джокеры/i)).toBeInTheDocument();
    expect(screen.getByText(/Таймер хода/i)).toBeInTheDocument();

    // Cheating defaults to ON → subgroup labels are visible.
    expect(screen.getByText(/Попыток мухляжа за партию/i)).toBeInTheDocument();
    expect(screen.getByText(/Кто видит мухляж/i)).toBeInTheDocument();

    // Submit is always available — there's no invalid combination possible
    // through the controls themselves (all are radios with a default selection).
    const submit = screen.getByRole('button', { name: /^Создать лобби$/i });
    expect(submit).not.toBeDisabled();
  });
});
