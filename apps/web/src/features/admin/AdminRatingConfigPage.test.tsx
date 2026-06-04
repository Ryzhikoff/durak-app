import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import type { RatingConfig } from '@durak/shared-types';

const baseConfig: RatingConfig = {
  initialMu: 25,
  initialSigma: 8.333,
  beta: 4.166,
  tau: 0.0833,
  drawProbability: 0.0,
  updatedAt: '2025-01-01T00:00:00.000Z',
  updatedById: null,
};

const updateRatingConfig = vi.fn(async (patch: Partial<RatingConfig>) => ({
  ...baseConfig,
  ...patch,
  updatedAt: '2025-06-01T00:00:00.000Z',
}));

vi.mock('./ratingConfigApi', () => ({
  fetchRatingConfig: vi.fn(async (): Promise<RatingConfig> => baseConfig),
  updateRatingConfig: (patch: Partial<RatingConfig>) =>
    updateRatingConfig(patch),
}));

import { AdminRatingConfigPage } from './AdminRatingConfigPage';

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

describe('AdminRatingConfigPage', () => {
  it('renders all fields, warning banner, and disables save until dirty/valid', async () => {
    renderWithProviders(<AdminRatingConfigPage />);

    expect(
      await screen.findByRole('heading', { name: /Параметры рейтинга/i }),
    ).toBeInTheDocument();

    // The 4 user-editable field labels are present (drawProbability is
    // intentionally hidden — Durak derives draw outcomes from the game).
    expect(screen.getByText(/Начальное μ/)).toBeInTheDocument();
    expect(screen.getByText(/Начальное σ/)).toBeInTheDocument();
    expect(screen.getByText(/β/)).toBeInTheDocument();
    expect(screen.getByText(/τ/)).toBeInTheDocument();
    // Draw-probability informational note replaces the old slider.
    expect(
      screen.getByText(/Вероятность ничьей сейчас не используется/),
    ).toBeInTheDocument();

    // Warning banner.
    expect(
      screen.getByText(/Изменения применяются только к новым играм/),
    ).toBeInTheDocument();

    // Save button is disabled when no edits were made yet.
    const save = screen.getByRole('button', { name: /Сохранить/ });
    expect(save).toBeDisabled();
  });

  it('flags invalid values and re-enables save when corrected', async () => {
    renderWithProviders(<AdminRatingConfigPage />);

    // Wait for form to populate.
    const muInput = await screen.findByLabelText(/Начальное μ/);
    const save = screen.getByRole('button', { name: /Сохранить/ });
    const user = userEvent.setup();

    // Set an out-of-range value (max for μ is 100).
    await user.clear(muInput);
    await user.type(muInput, '99999');
    expect(save).toBeDisabled();

    // Restore a valid edit.
    await user.clear(muInput);
    await user.type(muInput, '30');
    expect(save).not.toBeDisabled();
  });
});
