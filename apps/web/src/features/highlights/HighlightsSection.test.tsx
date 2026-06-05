import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { HighlightsResponse } from '@durak/shared-types';
import '@/lib/i18n';

// Mock the networked feature API so the component renders without a server.
vi.mock('./api', () => ({
  fetchHighlights: vi.fn(
    async (): Promise<HighlightsResponse> => ({
      items: [
        {
          id: 'cheater_day',
          category: 'cheating',
          period: 'day',
          title: 'Жулик дня',
          icon: '🤡',
          entries: [
            {
              userId: 'u1',
              nickname: 'Alice',
              avatarUrl: null,
              value: 3,
            },
            {
              userId: 'u2',
              nickname: 'Bob',
              avatarUrl: null,
              value: 1,
            },
          ],
        },
        {
          id: 'winner_week',
          category: 'wins',
          period: 'week',
          title: 'Победитель недели',
          icon: '👑',
          entries: [
            {
              userId: 'u3',
              nickname: 'Carol',
              avatarUrl: null,
              value: 5,
            },
          ],
        },
      ],
    }),
  ),
}));

import { HighlightsSection } from './HighlightsSection';

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

describe('HighlightsSection', () => {
  it('renders cards for each highlight returned by the API', async () => {
    renderWithProviders(<HighlightsSection />);

    expect(
      await screen.findByRole('heading', { name: /Интересное/i }),
    ).toBeInTheDocument();

    // Each highlight card carries a deterministic test id.
    expect(
      await screen.findByTestId('highlight-card-cheater_day'),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId('highlight-card-winner_week'),
    ).toBeInTheDocument();

    // Entry nicknames make it onto the page.
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(await screen.findByText('Carol')).toBeInTheDocument();
  });

  it('renders nothing when items is empty', async () => {
    // Override the next call to return an empty response. The fn is shared at
    // module level — `mockResolvedValueOnce` queues exactly one override for
    // the upcoming render's fetch.
    const apiMod = await import('./api');
    (apiMod.fetchHighlights as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [],
    } satisfies HighlightsResponse);

    const { container } = renderWithProviders(<HighlightsSection />);

    // The section starts in `isPending` (header + spinner). Once the query
    // resolves with empty items the component returns null, so the heading
    // disappears. Wait for that transition before asserting absence.
    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: /Интересное/i }),
      ).not.toBeInTheDocument();
    });
    expect(container.querySelector('[data-testid="highlights-grid"]')).toBeNull();
  });
});
