import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import type { RematchSession, User } from '@durak/shared-types';
import { useAuthStore } from '@/stores/auth.store';

// Stub the REST surface so the mutation paths in the modal stay hermetic.
const acceptMock = vi.fn();
const cancelMock = vi.fn();
vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return {
    ...actual,
    acceptRematch: (...args: unknown[]) => acceptMock(...args),
    cancelRematch: (...args: unknown[]) => cancelMock(...args),
  };
});

import { RematchModal } from './RematchModal';

const SETTINGS = {
  maxPlayers: 3 as const,
  firstBoutLimit: 5 as const,
  attackerScope: 'all' as const,
  exclusiveThrowIn: false,
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
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        {ui}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RematchModal', () => {
  beforeEach(() => {
    acceptMock.mockReset();
    cancelMock.mockReset();
    acceptMock.mockResolvedValue({ session: makeSession() });
    cancelMock.mockResolvedValue({ cancelled: true });
    // Default auth user — overridden inside individual tests.
    useAuthStore.getState().setUser(makeUser('ub'));
  });

  it('renders the initiator name, participants and the progress label', () => {
    const session = makeSession();
    renderWithProviders(<RematchModal session={session} open />);
    expect(screen.getByText(/Реванш/)).toBeInTheDocument();
    // Subtitle mentions the initiator (appears in multiple spots: avatar alt,
    // subtitle, list entry — use getAllByText so the assertion is order-agnostic).
    expect(screen.getAllByText(/Alice/).length).toBeGreaterThan(0);
    // Three rows in the participant list.
    expect(screen.getByTestId('rematch-participant-ua')).toBeInTheDocument();
    expect(screen.getByTestId('rematch-participant-ub')).toBeInTheDocument();
    expect(screen.getByTestId('rematch-participant-uc')).toBeInTheDocument();
    // Initiator already accepted -> badge visible.
    expect(screen.getByTestId('rematch-accepted-ua')).toBeInTheDocument();
    // Progress label reflects accepted/total.
    expect(screen.getByTestId('rematch-progress')).toHaveTextContent('1');
    expect(screen.getByTestId('rematch-progress')).toHaveTextContent('3');
    // Countdown is rendered.
    expect(screen.getByTestId('rematch-countdown')).toBeInTheDocument();
  });

  it('shows Accept + Decline for an invitee, hides Cancel', () => {
    useAuthStore.getState().setUser(makeUser('ub'));
    renderWithProviders(<RematchModal session={makeSession()} open />);
    expect(screen.getByTestId('rematch-accept')).toBeInTheDocument();
    expect(screen.getByTestId('rematch-decline')).toBeInTheDocument();
    expect(screen.queryByTestId('rematch-cancel')).not.toBeInTheDocument();
  });

  it('hides Accept once the invitee has already accepted', () => {
    useAuthStore.getState().setUser(makeUser('ub'));
    const session = makeSession({ accepted: ['ua', 'ub'] });
    renderWithProviders(<RematchModal session={session} open />);
    expect(screen.queryByTestId('rematch-accept')).not.toBeInTheDocument();
    // Decline is still available so the invitee can change their mind.
    expect(screen.getByTestId('rematch-decline')).toBeInTheDocument();
  });

  it('shows Cancel for the initiator and hides Accept', () => {
    useAuthStore.getState().setUser(makeUser('ua'));
    renderWithProviders(<RematchModal session={makeSession()} open />);
    expect(screen.queryByTestId('rematch-accept')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rematch-decline')).not.toBeInTheDocument();
    expect(screen.getByTestId('rematch-cancel')).toBeInTheDocument();
  });

  it('invokes acceptRematch with the source gameId when Accept is clicked', async () => {
    useAuthStore.getState().setUser(makeUser('ub'));
    renderWithProviders(<RematchModal session={makeSession()} open />);
    fireEvent.click(screen.getByTestId('rematch-accept'));
    await waitFor(() => {
      expect(acceptMock).toHaveBeenCalledWith('g-1');
    });
  });

  it('invokes cancelRematch for invitee Decline', async () => {
    useAuthStore.getState().setUser(makeUser('ub'));
    renderWithProviders(<RematchModal session={makeSession()} open />);
    fireEvent.click(screen.getByTestId('rematch-decline'));
    await waitFor(() => {
      expect(cancelMock).toHaveBeenCalledWith('g-1');
    });
  });

  it('invokes cancelRematch for initiator Cancel', async () => {
    useAuthStore.getState().setUser(makeUser('ua'));
    renderWithProviders(<RematchModal session={makeSession()} open />);
    fireEvent.click(screen.getByTestId('rematch-cancel'));
    await waitFor(() => {
      expect(cancelMock).toHaveBeenCalledWith('g-1');
    });
  });
});
