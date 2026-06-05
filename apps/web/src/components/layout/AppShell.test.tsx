import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import type { User } from '@durak/shared-types';
import { useAuthStore } from '@/stores/auth.store';
import { AppShell } from './AppShell';

// AppShell pulls in `useLogout` which would otherwise mount a real React-Query
// mutation; stub the API surface so jsdom doesn't try to hit the network.
vi.mock('@/features/auth/api', () => ({
  fetchMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
}));

const baseUser: User = {
  id: 'u1',
  login: 'admin',
  nickname: 'Admin',
  isAdmin: false,
  mustChangePassword: false,
  avatarUrl: null,
  cardBackId: 'classic-1',
  randomCardBack: false,
  customCardBackUrl: null,
  handSortMode: 'power',
  currentGameId: null,
};

function renderShell(initialPath: string = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[initialPath]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <AppShell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AppShell active-game banner', () => {
  it('renders the banner when user.currentGameId is set and route differs', () => {
    useAuthStore.setState({
      user: { ...baseUser, currentGameId: 'game-xyz' },
      status: 'authenticated',
    });
    renderShell('/');
    expect(screen.getByText(/У вас активная игра/i)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /Вернуться/i });
    expect(cta).toHaveAttribute('href', '/games/game-xyz');
  });

  it('hides the banner when user is already on the active-game page', () => {
    useAuthStore.setState({
      user: { ...baseUser, currentGameId: 'game-xyz' },
      status: 'authenticated',
    });
    renderShell('/games/game-xyz');
    expect(screen.queryByText(/У вас активная игра/i)).not.toBeInTheDocument();
  });

  it('does not render the banner when currentGameId is null', () => {
    useAuthStore.setState({
      user: { ...baseUser, currentGameId: null },
      status: 'authenticated',
    });
    renderShell('/');
    expect(screen.queryByText(/У вас активная игра/i)).not.toBeInTheDocument();
  });
});
