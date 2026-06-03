import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';

// Avoid hitting the real network in this smoke test.
vi.mock('./api', () => ({
  fetchMe: vi.fn().mockRejectedValue(new Error('not authenticated')),
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
}));

import { LoginPage } from './LoginPage';

function renderWithProviders(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={['/login']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        {ui}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  it('renders the title and the login form', async () => {
    renderWithProviders(<LoginPage />);
    expect(await screen.findByRole('heading', { name: /Вход/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Логин/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Пароль/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Войти/i })).toBeInTheDocument();
  });
});
