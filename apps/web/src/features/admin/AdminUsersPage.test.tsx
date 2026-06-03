import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import type { AdminUserListResponse } from '@durak/shared-types';

// Mock the network layer so the test doesn't hit the API.
vi.mock('./api', () => ({
  listUsers: vi.fn(
    async (): Promise<AdminUserListResponse> => ({
      items: [
        {
          id: 'u1',
          login: 'alice',
          nickname: 'Alice',
          isAdmin: true,
          mustChangePassword: false,
          avatarUrl: null,
          disabledAt: null,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    }),
  ),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  resetUserPassword: vi.fn(),
  deleteUser: vi.fn(),
}));

import { AdminUsersPage } from './AdminUsersPage';

function renderWithProviders(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminUsersPage', () => {
  it('renders the title, table headers, and loaded row', async () => {
    renderWithProviders(<AdminUsersPage />);

    expect(
      await screen.findByRole('heading', { name: /Игроки/i }),
    ).toBeInTheDocument();
    // Table headers (desktop table is rendered even though hidden via CSS).
    expect(await screen.findByText('Логин')).toBeInTheDocument();
    expect(screen.getByText('Никнейм')).toBeInTheDocument();
    expect(screen.getByText('Статус')).toBeInTheDocument();
    expect(screen.getByText('Действия')).toBeInTheDocument();
    // Loaded user appears.
    expect(await screen.findAllByText('alice')).not.toHaveLength(0);
  });
});
