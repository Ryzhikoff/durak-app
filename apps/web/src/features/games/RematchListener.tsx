/**
 * Global rematch-flow listener. Mounted once at the top of {@link AppShell}
 * so the rematch modal can pop on ANY route (the user might be sitting on
 * `/rating` while another seat clicks "Ещё партия" in the finished game's
 * detail page).
 *
 * Subscribes to the `/games` WebSocket namespace and updates the shared
 * TanStack-Query cache slot owned by {@link useRematchSession}. The cache slot
 * is the single source of truth; this component never carries session state
 * locally — EXCEPT for the inline cancel-notice banner. The banner replaces
 * the old `window.dispatchEvent('app:toast')` notification which had no
 * listener and was silently dropped, leaving users wondering why the modal
 * vanished.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  REMATCH_EVENTS,
  type RematchCancelledEvent,
  type RematchInviteEvent,
  type RematchSession,
  type RematchStartedEvent,
  type RematchUpdatedEvent,
} from '@durak/shared-types';
import { Alert } from '@/components/ui';
import { useAuthStore } from '@/stores/auth.store';
import { REMATCH_SESSION_QUERY_KEY, useRematchSession } from './hooks';
import { gamesSocket, useGameSocket } from './socket';
import { RematchModal } from './RematchModal';

/** How long the inline cancel banner stays on screen before auto-dismiss. */
const BANNER_AUTO_DISMISS_MS = 5000;

interface CancelNotice {
  text: string;
  at: number;
}

export function RematchListener() {
  useGameSocket();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const session = useRematchSession();
  const myUserId = useAuthStore((s) => s.user?.id);
  const [notice, setNotice] = useState<CancelNotice | null>(null);

  useEffect(() => {
    if (!myUserId) return;

    const setSession = (next: RematchSession | null) => {
      qc.setQueryData<RematchSession | null>(REMATCH_SESSION_QUERY_KEY, next);
    };

    const isTarget = (s: RematchSession) =>
      !!myUserId && s.expectedUserIds.includes(myUserId);

    const onInvited = (payload: RematchInviteEvent) => {
      if (!isTarget(payload)) return;
      // A fresh invite supersedes any stale cancel-notice from a prior round.
      setNotice(null);
      setSession(payload);
    };
    const onUpdated = (payload: RematchUpdatedEvent) => {
      if (!isTarget(payload)) return;
      setSession(payload);
    };
    const onStarted = (payload: RematchStartedEvent) => {
      // Clear the modal and route into the new game. We don't gate on
      // membership: if the server fanned the `started` event our way, we
      // were a participant. Also drop any leftover cancel banner — a
      // successful start should win the screen.
      setSession(null);
      setNotice(null);
      navigate(`/games/${payload.newGameId}`);
    };
    const onCancelled = (payload: RematchCancelledEvent) => {
      setSession(null);
      const messageKey =
        payload.reason === 'expired'
          ? 'rematch.timeoutMessage'
          : payload.reason === 'declined'
            ? 'rematch.declineMessage'
            : payload.reason === 'spawn_failed'
              ? 'rematch.spawnFailedMessage'
              : 'rematch.cancelMessage';
      setNotice({ text: t(messageKey), at: Date.now() });
    };

    gamesSocket.on(REMATCH_EVENTS.invited, onInvited);
    gamesSocket.on(REMATCH_EVENTS.updated, onUpdated);
    gamesSocket.on(REMATCH_EVENTS.started, onStarted);
    gamesSocket.on(REMATCH_EVENTS.cancelled, onCancelled);
    return () => {
      gamesSocket.off(REMATCH_EVENTS.invited, onInvited);
      gamesSocket.off(REMATCH_EVENTS.updated, onUpdated);
      gamesSocket.off(REMATCH_EVENTS.started, onStarted);
      gamesSocket.off(REMATCH_EVENTS.cancelled, onCancelled);
    };
  }, [myUserId, navigate, qc, t]);

  // Auto-dismiss the cancel banner after BANNER_AUTO_DISMISS_MS. Keyed by the
  // notice `at` timestamp so a fresh notice resets the timer.
  useEffect(() => {
    if (!notice) return;
    const handle = setTimeout(() => {
      setNotice((current) => (current && current.at === notice.at ? null : current));
    }, BANNER_AUTO_DISMISS_MS);
    return () => clearTimeout(handle);
  }, [notice]);

  // Render the modal when there's a live session AND the viewer is actually
  // a target (defensive — the listener already filters non-targets).
  const showModal = !!session && (!myUserId || session.expectedUserIds.includes(myUserId));

  return (
    <>
      {showModal && session ? <RematchModal session={session} open /> : null}
      {notice ? (
        <div
          className="pointer-events-none fixed inset-x-0 top-4 z-[1000] flex justify-center px-4"
          data-testid="rematch-notice"
        >
          <Alert
            variant="info"
            className="pointer-events-auto max-w-md shadow-lg"
            data-testid="rematch-notice-alert"
          >
            {notice.text}
          </Alert>
        </div>
      ) : null}
    </>
  );
}
