import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import type { UserTextReactionDTO } from '@durak/shared-types';
import { USER_TEXT_REACTION_MAX_PER_USER } from '@durak/shared-types';

// Mutable store the mocked API mutates; reset in beforeEach.
let store: UserTextReactionDTO[] = [];
const createMock = vi.fn(
  async ({ text }: { text: string }): Promise<UserTextReactionDTO> => {
    const row: UserTextReactionDTO = {
      id: `r-${store.length + 1}`,
      text,
      sortOrder: 0,
      createdAt: new Date().toISOString(),
    };
    store = [...store, row];
    return row;
  },
);
const deleteMock = vi.fn(async (id: string) => {
  store = store.filter((r) => r.id !== id);
  return { id };
});

vi.mock('@/features/games/userTextReactionsApi', () => ({
  ME_TEXT_REACTIONS_QUERY_KEY: ['me-text-reactions'] as const,
  fetchMyTextReactions: () => Promise.resolve(store),
  createMyTextReaction: (body: { text: string }) => createMock(body),
  deleteMyTextReaction: (id: string) => deleteMock(id),
}));

// Import the component AFTER mocks are registered.
import { MyTextReactions } from './MyTextReactions';

function renderWithProviders() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MyTextReactions />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  store = [];
  createMock.mockClear();
  deleteMock.mockClear();
});

describe('MyTextReactions', () => {
  it('shows the empty state when the list is empty', async () => {
    renderWithProviders();
    await screen.findByTestId('my-text-reactions-empty');
  });

  it('adds a new reaction via the input + button and clears the input on success', async () => {
    renderWithProviders();
    const user = userEvent.setup();

    const input = await screen.findByTestId('my-text-reactions-input');
    await user.type(input, '  Хороший ход!  ');

    const add = screen.getByTestId('my-text-reactions-add');
    await user.click(add);

    // Mutation called with the trimmed string.
    expect(createMock).toHaveBeenCalledWith({ text: 'Хороший ход!' });
    // List re-fetches and the new row shows up.
    const row = await screen.findByText('Хороший ход!');
    expect(row).toBeInTheDocument();
    // Input is cleared.
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('keeps the add button disabled when the input is empty (whitespace-only too)', async () => {
    renderWithProviders();
    const user = userEvent.setup();

    const add = await screen.findByTestId('my-text-reactions-add');
    expect(add).toBeDisabled();

    const input = screen.getByTestId('my-text-reactions-input');
    await user.type(input, '   ');
    expect(add).toBeDisabled();

    await user.type(input, 'x');
    expect(add).not.toBeDisabled();
  });

  it('deletes a reaction when the delete button is clicked', async () => {
    store = [
      { id: 'r-1', text: 'Bye', sortOrder: 0, createdAt: '2026-06-10T10:00:00.000Z' },
    ];
    renderWithProviders();
    const user = userEvent.setup();

    const del = await screen.findByTestId('my-text-reactions-delete-r-1');
    await user.click(del);

    expect(deleteMock).toHaveBeenCalledWith('r-1');
    // After invalidation, the empty state renders.
    await screen.findByTestId('my-text-reactions-empty');
  });

  it('shows the limit-reached badge and disables the input when at cap', async () => {
    store = Array.from({ length: USER_TEXT_REACTION_MAX_PER_USER }, (_, i) => ({
      id: `r-${i + 1}`,
      text: `phrase ${i}`,
      sortOrder: i,
      createdAt: '2026-06-10T10:00:00.000Z',
    }));
    renderWithProviders();

    // Counter shows N / 20 and the limit indicator + disabled input appear.
    await screen.findByTestId('my-text-reactions-counter');
    expect(screen.getByTestId('my-text-reactions-counter').textContent).toContain(
      `${USER_TEXT_REACTION_MAX_PER_USER}`,
    );
    expect(screen.getByTestId('my-text-reactions-limit')).toBeInTheDocument();
    expect(screen.getByTestId('my-text-reactions-input')).toBeDisabled();
    expect(screen.getByTestId('my-text-reactions-add')).toBeDisabled();
  });

  it('renders all rows in the list with delete buttons', async () => {
    store = [
      { id: 'r-1', text: 'A', sortOrder: 0, createdAt: '2026-06-10T10:00:00.000Z' },
      { id: 'r-2', text: 'B', sortOrder: 1, createdAt: '2026-06-10T10:00:00.000Z' },
    ];
    renderWithProviders();
    await screen.findByTestId('my-text-reactions-row-r-1');
    expect(screen.getByTestId('my-text-reactions-row-r-2')).toBeInTheDocument();
  });
});
