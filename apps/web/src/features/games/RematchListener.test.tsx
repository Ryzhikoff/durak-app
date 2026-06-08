import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import {
  REMATCH_EVENTS,
  type RematchSession,
  type User,
} from '@durak/shared-types';
import { useAuthStore } from '@/stores/auth.store';

/**
 * Capture the handlers RematchListener registers on the games socket so we
 * can drive `rematch:invited` / `rematch:cancelled` directly from the test.
 */
const handlers = new Map<string, (payload: unknown) => void>();
vi.mock('./socket', () => ({
  gamesSocket: {
    on: vi.fn((event: string, fn: (payload: unknown) => void) => {
      handlers.set(event, fn);
    }),
    off: vi.fn((event: string) => {
      handlers.delete(event);
    }),
    once: vi.fn(),
    connected: false,
  },
  useGameSocket: vi.fn(),
  connectGames: vi.fn(),
  disconnectGames: vi.fn(),
}));

import { RematchListener } from './RematchListener';
import { REMATCH_SESSION_QUERY_KEY } from './hooks';

const SETTINGS = {
  maxPlayers: 3 as const,
  firstBoutLimit: 5 as const,
  attackerScope: 'all' as const,
  cheatingEnabled: false,
  cheatAttempts: 0,
  cheatNoticeScope: 'defender_only' as const,
  layoutOnRepeat: 'random' as const,
  firstTurn: 'lowest_trump' as const,
  deckSize: 36 as const,
  jokers: false,
  turnTimer: null,
};

function makeSession(overrides: Partial<RematchSession> = {}): RematchSession {
  return {
    sourceGameId: 'g-1',
    initiator: { userId: 'ua', nickname: 'Alice', avatarUrl: null },
    expectedUserIds: ['ua', 'ub', 'uc'],
    accepted: ['ua'],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    settings: SETTINGS,
    composition: ['ua', 'ub', 'uc'],
    participants: [
      { userId: 'ua', nickname: 'Alice', avatarUrl: null },
      { userId: 'ub', nickname: 'Bob', avatarUrl: null },
      { userId: 'uc', nickname: 'Carol', avatarUrl: null },
    ],
    ...overrides,
  };
}

function makeUser(id: string): User {
  return {
    id,
    login: id,
    nickname: id,
    isAdmin: false,
    mustChangePassword: false,
    avatarUrl: null,
    cardBackId: 'classic-1',
    randomCardBack: false,
    customCardBackUrl: null,
    handSortMode: 'power',
    currentGameId: null,
  };
}

function renderWithProviders(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Seed the cache with the active session so the modal renders on mount.
  client.setQueryData<RematchSession | null>(REMATCH_SESSION_QUERY_KEY, makeSession());
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          {ui}
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

describe('RematchListener inline cancel banner', () => {
  beforeEach(() => {
    handlers.clear();
    useAuthStore.getState().setUser(makeUser('ub'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the timeout banner on `rematch:cancelled` (expired) and hides the modal', () => {
    vi.useFakeTimers();
    const { client } = renderWithProviders(<RematchListener />);

    // Sanity: modal renders because the cache has a live session.
    expect(screen.getByText(/Реванш/)).toBeInTheDocument();

    // Server fires `rematch:cancelled` with reason=expired.
    const onCancelled = handlers.get(REMATCH_EVENTS.cancelled);
    expect(onCancelled).toBeTypeOf('function');
    act(() => {
      onCancelled!({ sourceGameId: 'g-1', reason: 'expired' });
    });

    // Modal is gone (session cleared from the cache).
    expect(client.getQueryData(REMATCH_SESSION_QUERY_KEY)).toBeNull();
    expect(screen.queryByTestId('rematch-participants')).not.toBeInTheDocument();

    // Inline banner has appeared with the timeout copy from ru.json.
    const notice = screen.getByTestId('rematch-notice-alert');
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveTextContent('Время реванша истекло');

    // After 5s the banner auto-dismisses.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId('rematch-notice-alert')).not.toBeInTheDocument();
  });

  it('shows the spawn-failed banner copy when reason is spawn_failed', () => {
    vi.useFakeTimers();
    renderWithProviders(<RematchListener />);
    const onCancelled = handlers.get(REMATCH_EVENTS.cancelled);
    act(() => {
      onCancelled!({ sourceGameId: 'g-1', reason: 'spawn_failed' });
    });
    const notice = screen.getByTestId('rematch-notice-alert');
    expect(notice).toHaveTextContent('Не удалось создать игру');
  });
});
