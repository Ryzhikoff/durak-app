/**
 * Phase 8 — disconnect-pause overlay. Renders a banner at the top of the game
 * page whenever the live cache reports a non-null `pauseInfo`. Two visual
 * modes:
 *
 *  - Grace window (vote not open): countdown to `timeoutAt` with a short
 *    nickname list of the disconnected seats.
 *  - Vote window (`voteOpen=true`): countdown to the SAME `timeoutAt` field
 *    but with two big action buttons + a tally of who voted what.
 *
 * The countdown ticks every second on the client using `setInterval`.
 * `timeoutAt` is an ISO string from the server, so the math is timezone-safe.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { getApiErrorMessage } from '@/lib/api';
import type { ClientGamePlayer, ClientGameState, PauseInfo, PauseVote } from './types';

export interface PauseOverlayProps {
  pauseInfo: PauseInfo;
  state: ClientGameState;
  myUserId: string;
  myVote: PauseVote | null;
  isSubmitting: boolean;
  onVote: (vote: PauseVote) => Promise<void>;
}

export function PauseOverlay({
  pauseInfo,
  state,
  myUserId,
  myVote,
  isSubmitting,
  onVote,
}: PauseOverlayProps) {
  const { t } = useTranslation();
  // Tick once per second so the countdown updates. We intentionally use
  // wall-clock comparisons — no interval drift fixes needed for a 60s timer.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const deadlineMs = useMemo(
    () => new Date(pauseInfo.timeoutAt).getTime(),
    [pauseInfo.timeoutAt],
  );
  const remainingSec = Math.max(0, Math.ceil((deadlineMs - now) / 1000));

  const disconnectedNicknames = useMemo(
    () =>
      pauseInfo.disconnectedUserIds.map((id) => {
        const seat = state.players.find((p: ClientGamePlayer) => p.id === id);
        return seat?.nickname ?? id;
      }),
    [pauseInfo.disconnectedUserIds, state.players],
  );

  // Voter list for the tally row — active, connected, in-game seats. We
  // approximate "connected" client-side by saying anyone NOT in the
  // disconnected set qualifies (the server already filtered them out of the
  // voter pool). Finished players are excluded.
  const voters = useMemo(() => {
    const disconnected = new Set(pauseInfo.disconnectedUserIds);
    return state.players.filter(
      (p) => !disconnected.has(p.id) && !p.isFinished,
    );
  }, [pauseInfo.disconnectedUserIds, state.players]);

  const [voteError, setVoteError] = useState<string | null>(null);
  const submit = async (choice: PauseVote) => {
    try {
      setVoteError(null);
      await onVote(choice);
    } catch (err: unknown) {
      setVoteError(getApiErrorMessage(err, t('errors.generic')));
    }
  };

  // The viewer is allowed to vote iff:
  //  - the vote window is open,
  //  - they're not on the disconnected list themselves,
  //  - they haven't already finished.
  const mySeat = state.players.find((p) => p.id === myUserId);
  const canVote =
    pauseInfo.voteOpen &&
    !pauseInfo.disconnectedUserIds.includes(myUserId) &&
    mySeat !== undefined &&
    !mySeat.isFinished;

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-warning/60 bg-warning/10 px-2 py-1 text-xs"
      data-testid="pause-overlay"
      role="status"
      aria-live="polite"
    >
      <span className="font-semibold text-warning">
        {pauseInfo.voteOpen
          ? t('game.pause.voteTitle')
          : t('game.pause.title')}
      </span>
      <span className="text-textMuted" data-testid="pause-countdown">
        {t('game.pause.timeLeft', { seconds: remainingSec })}
      </span>
      <span className="text-text">
        {t('game.pause.waitingFor', {
          nicknames: disconnectedNicknames.join(', '),
        })}
      </span>

      {pauseInfo.voteOpen ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant={myVote === 'wait_more' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => void submit('wait_more')}
            disabled={!canVote || isSubmitting}
            data-testid="pause-vote-wait"
            aria-pressed={myVote === 'wait_more'}
            className="!h-6 !px-2 !text-[11px]"
          >
            {t('game.pause.vote.waitShort')}
          </Button>
          <Button
            variant={myVote === 'concede' ? 'danger' : 'secondary'}
            size="sm"
            onClick={() => void submit('concede')}
            disabled={!canVote || isSubmitting}
            data-testid="pause-vote-concede"
            aria-pressed={myVote === 'concede'}
            className="!h-6 !px-2 !text-[11px]"
          >
            {t('game.pause.vote.concedeShort')}
          </Button>
          {/* Compact tally — just counts, nicknames suppressed to keep the
              banner one-line on most viewports. Hover for the breakdown. */}
          <span
            className="text-textMuted"
            data-testid="pause-vote-tally"
            title={voters
              .map((v) => {
                const cast = pauseInfo.votes[v.id];
                return `${v.nickname}: ${
                  cast === 'wait_more'
                    ? t('game.pause.vote.waitShort')
                    : cast === 'concede'
                      ? t('game.pause.vote.concedeShort')
                      : t('game.pause.vote.pending')
                }`;
              })
              .join(' · ')}
          >
            ({Object.keys(pauseInfo.votes).length}/{voters.length})
          </span>
        </div>
      ) : null}

      {voteError ? <span className="text-danger">{voteError}</span> : null}
    </div>
  );
}
