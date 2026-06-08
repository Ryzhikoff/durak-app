import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import type { FaceCardAsset } from '@durak/shared-types';

const fetchAdminFaceCardsMock = vi.fn(async (): Promise<FaceCardAsset[]> => []);
const fetchFaceCardsMock = vi.fn(async (): Promise<FaceCardAsset[]> => []);
const uploadFaceCardMock = vi.fn(
  async (rank: string, suit: string, _file: File): Promise<FaceCardAsset> => ({
    rank: rank as FaceCardAsset['rank'],
    suit: suit as FaceCardAsset['suit'],
    url: null,
  }),
);
const deleteFaceCardMock = vi.fn(
  async (rank: string, suit: string): Promise<FaceCardAsset> => ({
    rank: rank as FaceCardAsset['rank'],
    suit: suit as FaceCardAsset['suit'],
    url: null,
  }),
);

vi.mock('@/features/games/faceCardsApi', () => ({
  fetchAdminFaceCards: () => fetchAdminFaceCardsMock(),
  fetchFaceCards: () => fetchFaceCardsMock(),
  uploadFaceCard: (rank: string, suit: string, file: File) =>
    uploadFaceCardMock(rank, suit, file),
  deleteFaceCard: (rank: string, suit: string) => deleteFaceCardMock(rank, suit),
}));

import { AdminFaceCardsPage } from './AdminFaceCardsPage';

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AdminFaceCardsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminFaceCardsPage', () => {
  beforeEach(() => {
    fetchAdminFaceCardsMock.mockReset();
    fetchFaceCardsMock.mockReset();
    uploadFaceCardMock.mockReset();
    deleteFaceCardMock.mockReset();
    fetchFaceCardsMock.mockImplementation(async () => []);
    fetchAdminFaceCardsMock.mockImplementation(async () => []);
  });

  it('renders 12 slots when nothing is uploaded yet', async () => {
    fetchAdminFaceCardsMock.mockImplementationOnce(async () => []);
    renderPage();
    await screen.findByRole('heading', { name: /Картинки фигурных карт/i });
    // Each slot exposes its rank label ("Валет"/"Дама"/"Король"). 3 ranks × 4
    // suits = 12 total.
    const labelCounts = [
      screen.queryAllByText('Валет').length,
      screen.queryAllByText('Дама').length,
      screen.queryAllByText('Король').length,
    ];
    expect(labelCounts).toEqual([4, 4, 4]);
    // All slots start in "default" state — no reset button is shown.
    expect(screen.queryAllByRole('button', { name: /Сбросить/ })).toHaveLength(0);
  });

  it('shows "Свой рисунок" and a reset button for slots that already have an upload', async () => {
    fetchAdminFaceCardsMock.mockImplementationOnce(async () => [
      {
        rank: 'queen',
        suit: 'hearts',
        url: '/uploads/face-cards/queen-hearts.webp?v=1',
      },
    ]);
    renderPage();
    await screen.findByRole('heading', { name: /Картинки фигурных карт/i });
    await waitFor(() =>
      expect(screen.getAllByText(/Свой рисунок/).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByRole('button', { name: /Сбросить/ })).toHaveLength(1);
  });

  it('uploading a file fires the mutation with the correct (rank, suit) tuple', async () => {
    fetchAdminFaceCardsMock.mockImplementationOnce(async () => []);
    uploadFaceCardMock.mockImplementationOnce(async () => ({
      rank: 'jack',
      suit: 'spades',
      url: '/uploads/face-cards/jack-spades.webp?v=2',
    }));
    const { container } = renderPage();
    await screen.findByRole('heading', { name: /Картинки фигурных карт/i });

    // The hidden inputs are rendered in DOM order (rank.flatMap × suit) so the
    // very first one belongs to (jack, spades).
    const inputs = container.querySelectorAll('input[type="file"]');
    expect(inputs.length).toBe(12);
    const first = inputs[0] as HTMLInputElement;
    const file = new File([Uint8Array.from([0])], 'jack.png', { type: 'image/png' });
    const user = userEvent.setup();
    await user.upload(first, file);

    await waitFor(() => expect(uploadFaceCardMock).toHaveBeenCalledTimes(1));
    const [rank, suit, sentFile] = uploadFaceCardMock.mock.calls[0];
    expect(rank).toBe('jack');
    expect(suit).toBe('spades');
    expect(sentFile.name).toBe('jack.png');
  });
});
