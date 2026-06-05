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
import { Alert, Button } from '@/components/ui';
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
      className="sticky top-2 z-40 flex flex-col gap-2 rounded-lg border border-warning bg-warning/10 p-3 text-sm shadow-md"
      data-testid="pause-overlay"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold text-warning">
          {pauseInfo.voteOpen
            ? t('game.pause.voteTitle')
            : t('game.pause.title')}
        </span>
        <span className="text-textMuted" data-testid="pause-countdown">
          {t('game.pause.timeLeft', { seconds: remainingSec })}
        </span>
      </div>
      <p className="text-text">
        {t('game.pause.waitingFor', {
          nicknames: disconnectedNicknames.join(', '),
        })}
      </p>

      {pauseInfo.voteOpen ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant={myVote === 'wait_more' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => void submit('wait_more')}
              disabled={!canVote || isSubmitting}
              data-testid="pause-vote-wait"
              aria-pressed={myVote === 'wait_more'}
            >
              {t('game.pause.vote.waitMore')}
            </Button>
            <Button
              variant={myVote === 'concede' ? 'danger' : 'secondary'}
              size="sm"
              onClick={() => void submit('concede')}
              disabled={!canVote || isSubmitting}
              data-testid="pause-vote-concede"
              aria-pressed={myVote === 'concede'}
            >
              {t('game.pause.vote.concede')}
            </Button>
          </div>
          <ul
            className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-textMuted"
            data-testid="pause-vote-tally"
          >
            {voters.map((v) => {
              const cast = pauseInfo.votes[v.id];
              return (
                <li
                  key={v.id}
                  className="flex items-center gap-1"
                  data-testid={`pause-vote-tally-${v.id}`}
                >
                  <span>{v.nickname}</span>
                  <span aria-hidden>·</span>
                  <span>
                    {cast === 'wait_more'
                      ? t('game.pause.vote.waitShort')
                      : cast === 'concede'
                        ? t('game.pause.vote.concedeShort')
                        : t('game.pause.vote.pending')}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {voteError ? (
        <Alert variant="error" className="text-xs">
          {voteError}
        </Alert>
      ) : null}
    </div>
  );
}
