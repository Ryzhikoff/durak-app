/**
 * Rematch coordinator modal.
 *
 * Rendered globally by {@link RematchListener} whenever the live session for
 * the current viewer is non-null. The viewer is always in `expectedUserIds`
 * (the global listener filters non-targets out before flipping the cache).
 *
 *  - The initiator sees a "Cancel" CTA.
 *  - The invitees see "Accept" + "Decline" CTAs (Accept hidden once they're
 *    already in `accepted`).
 *  - Both sides see a progress meter + a countdown to expiresAt.
 *
 * Modal state is wholly driven by the TanStack-Query cache slot owned by
 * {@link useRematchSession}; this component never holds a session locally.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import clsx from 'clsx';
import type { RematchSession } from '@durak/shared-types';
import { Alert, Button, Modal } from '@/components/ui';
import { Avatar } from '@/components/Avatar';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import { useAcceptRematch, useCancelRematch } from './hooks';

interface RematchModalProps {
  session: RematchSession;
  open: boolean;
}

export function RematchModal({ session, open }: RematchModalProps) {
  const { t } = useTranslation();
  const myUserId = useAuthStore((s) => s.user?.id);
  const isInitiator = myUserId === session.initiator.userId;
  const haveAccepted = !!myUserId && session.accepted.includes(myUserId);
  const remainingSec = useCountdown(session.expiresAt);

  const accept = useAcceptRematch();
  const cancel = useCancelRematch();
  const [error, setError] = useState<string | null>(null);

  // Reset the inline error whenever the user retries by clicking Accept again
  // — otherwise a stale error sticks around forever even after success.
  useEffect(() => {
    if (accept.isPending || cancel.isPending) setError(null);
  }, [accept.isPending, cancel.isPending]);

  const onAccept = async () => {
    setError(null);
    try {
      await accept.mutateAsync(session.sourceGameId);
    } catch (err) {
      setError(translateError(err, t));
    }
  };

  const onCancel = async () => {
    setError(null);
    try {
      await cancel.mutateAsync(session.sourceGameId);
    } catch (err) {
      setError(translateError(err, t));
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => undefined}
      title={t('rematch.modal.title')}
      dismissible={false}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm text-textMuted">
          <Avatar
            src={session.initiator.avatarUrl}
            nickname={session.initiator.nickname}
            size={32}
          />
          <span>
            {isInitiator
              ? t('rematch.modal.youStarted')
              : t('rematch.modal.subtitle', {
                  nickname: session.initiator.nickname,
                })}
          </span>
        </div>

        <ul
          className="flex flex-col gap-1.5"
          aria-label={t('rematch.modal.participants')}
          data-testid="rematch-participants"
        >
          {session.participants.map((p) => {
            const accepted = session.accepted.includes(p.userId);
            const isMe = p.userId === myUserId;
            return (
              <li
                key={p.userId}
                className={clsx(
                  'flex items-center gap-2 rounded-lg border border-border px-2 py-1.5',
                  accepted ? 'bg-success/10' : 'bg-surface',
                )}
                data-testid={`rematch-participant-${p.userId}`}
                data-accepted={accepted ? 'true' : 'false'}
              >
                <Avatar src={p.avatarUrl} nickname={p.nickname} size={28} />
                <span className="flex-1 truncate text-sm font-medium">
                  {p.nickname}
                  {isMe ? (
                    <span className="ml-1 text-xs text-textMuted">
                      {t('rematch.modal.youSuffix')}
                    </span>
                  ) : null}
                </span>
                {accepted ? (
                  <span
                    className="inline-flex items-center gap-1 text-xs font-medium text-success"
                    data-testid={`rematch-accepted-${p.userId}`}
                  >
                    <Check className="h-4 w-4" />
                    {t('rematch.modal.acceptedBadge')}
                  </span>
                ) : (
                  <span className="text-xs text-textMuted">
                    {t('rematch.modal.waitingBadge')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between text-xs text-textMuted">
          <span data-testid="rematch-progress">
            {t('rematch.modal.progress', {
              accepted: session.accepted.length,
              total: session.expectedUserIds.length,
            })}
          </span>
          <span data-testid="rematch-countdown">
            {t('rematch.modal.countdown', { seconds: remainingSec })}
          </span>
        </div>

        {error ? <Alert variant="error">{error}</Alert> : null}

        <div className="mt-1 flex flex-col gap-2">
          {!isInitiator && !haveAccepted ? (
            <Button
              block
              variant="primary"
              onClick={onAccept}
              disabled={accept.isPending}
              data-testid="rematch-accept"
            >
              {accept.isPending ? t('rematch.accepting') : t('rematch.accept')}
            </Button>
          ) : null}
          {!isInitiator ? (
            <Button
              block
              variant="secondary"
              onClick={onCancel}
              disabled={cancel.isPending}
              data-testid="rematch-decline"
            >
              {t('rematch.decline')}
            </Button>
          ) : (
            <Button
              block
              variant="secondary"
              onClick={onCancel}
              disabled={cancel.isPending}
              data-testid="rematch-cancel"
            >
              {t('rematch.cancel')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Read the `Date.now()` against `expiresAt` every 500ms; clamp at 0. */
function useCountdown(isoDeadline: string): number {
  const deadlineMs = useMemo(() => new Date(isoDeadline).getTime(), [isoDeadline]);
  const [seconds, setSeconds] = useState(() =>
    Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000)),
  );
  useEffect(() => {
    const tick = () => {
      setSeconds(Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000)));
    };
    tick();
    const handle = setInterval(tick, 500);
    return () => clearInterval(handle);
  }, [deadlineMs]);
  return seconds;
}

function translateError(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  const code = getApiErrorCode(err);
  if (code) {
    return t(`errors.${code}`, {
      defaultValue: getApiErrorMessage(err, t('errors.generic')),
    });
  }
  return getApiErrorMessage(err, t('errors.generic'));
}
