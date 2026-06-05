import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/lib/i18n';
import type { ClientGameState, PauseInfo } from './types';
import { PauseOverlay } from './PauseOverlay';

const STATE: ClientGameState = {
  id: 'g1',
  myUserId: 'u-me',
  settings: {
    maxPlayers: 3,
    firstBoutLimit: 6,
    attackerScope: 'all',
    cheatingEnabled: false,
    cheatAttempts: 0,
    cheatNoticeScope: 'defender_only',
    layoutOnRepeat: 'random',
    firstTurn: 'lowest_trump',
    deckSize: 36,
    jokers: false,
    turnTimer: null,
  },
  status: 'bout_attack',
  trumpCard: null,
  trumpSuit: null,
  deckSize: 0,
  discardSize: 0,
  table: { attacks: [] },
  boutNumber: 1,
  loserPlayerId: null,
  currentAttackerId: 'u-me',
  currentDefenderId: 'u-opp',
  passedPlayerIds: [],
  players: [
    {
      id: 'u-me',
      nickname: 'Me',
      avatarUrl: null,
      cardBackId: 'classic-1',
      customCardBackUrl: null,
      handSize: 6,
      isFinished: false,
      isPassed: false,
      cheatAttemptsRemaining: 0,
    },
    {
      id: 'u-opp',
      nickname: 'Opponent',
      avatarUrl: null,
      cardBackId: 'classic-1',
      customCardBackUrl: null,
      handSize: 6,
      isFinished: false,
      isPassed: false,
      cheatAttemptsRemaining: 0,
    },
    {
      id: 'u-ghost',
      nickname: 'Ghost',
      avatarUrl: null,
      cardBackId: 'classic-1',
      customCardBackUrl: null,
      handSize: 6,
      isFinished: false,
      isPassed: false,
      cheatAttemptsRemaining: 0,
    },
  ],
};

function pauseInfo(extra: Partial<PauseInfo> = {}): PauseInfo {
  const now = Date.now();
  return {
    disconnectedUserIds: ['u-ghost'],
    pausedAt: new Date(now).toISOString(),
    timeoutAt: new Date(now + 60_000).toISOString(),
    voteOpen: false,
    voteOpenedAt: null,
    votes: {},
    ...extra,
  };
}

describe('PauseOverlay smoke', () => {
  it('renders the grace banner with the disconnected nickname and a countdown', () => {
    render(
      <PauseOverlay
        pauseInfo={pauseInfo()}
        state={STATE}
        myUserId="u-me"
        myVote={null}
        isSubmitting={false}
        onVote={vi.fn()}
      />,
    );
    expect(screen.getByTestId('pause-overlay')).toBeInTheDocument();
    expect(screen.getByText(/Ghost/)).toBeInTheDocument();
    expect(screen.getByTestId('pause-countdown')).toBeInTheDocument();
    // No vote buttons during the grace window.
    expect(screen.queryByTestId('pause-vote-wait')).toBeNull();
    expect(screen.queryByTestId('pause-vote-concede')).toBeNull();
  });

  it('renders vote buttons + tally and dispatches a vote click', async () => {
    const onVote = vi.fn().mockResolvedValue(undefined);
    render(
      <PauseOverlay
        pauseInfo={pauseInfo({ voteOpen: true, voteOpenedAt: new Date().toISOString() })}
        state={STATE}
        myUserId="u-me"
        myVote={null}
        isSubmitting={false}
        onVote={onVote}
      />,
    );
    expect(screen.getByTestId('pause-vote-wait')).toBeInTheDocument();
    expect(screen.getByTestId('pause-vote-concede')).toBeInTheDocument();
    // Tally row lists the two active voters (Me + Opponent), not the ghost.
    expect(screen.getByTestId('pause-vote-tally-u-me')).toBeInTheDocument();
    expect(screen.getByTestId('pause-vote-tally-u-opp')).toBeInTheDocument();
    expect(screen.queryByTestId('pause-vote-tally-u-ghost')).toBeNull();
    fireEvent.click(screen.getByTestId('pause-vote-wait'));
    expect(onVote).toHaveBeenCalledWith('wait_more');
  });

  it('highlights the existing vote via aria-pressed', () => {
    render(
      <PauseOverlay
        pauseInfo={pauseInfo({
          voteOpen: true,
          voteOpenedAt: new Date().toISOString(),
          votes: { 'u-me': 'concede' },
        })}
        state={STATE}
        myUserId="u-me"
        myVote="concede"
        isSubmitting={false}
        onVote={vi.fn()}
      />,
    );
    expect(screen.getByTestId('pause-vote-concede')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('pause-vote-wait')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('disables vote buttons for a disconnected viewer', () => {
    render(
      <PauseOverlay
        pauseInfo={pauseInfo({ voteOpen: true, voteOpenedAt: new Date().toISOString() })}
        state={STATE}
        myUserId="u-ghost"
        myVote={null}
        isSubmitting={false}
        onVote={vi.fn()}
      />,
    );
    expect(screen.getByTestId('pause-vote-wait')).toBeDisabled();
    expect(screen.getByTestId('pause-vote-concede')).toBeDisabled();
  });
});
