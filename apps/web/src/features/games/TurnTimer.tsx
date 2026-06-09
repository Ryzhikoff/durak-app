import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { TurnTimerState } from '@durak/shared-types';

/**
 * Tailwind-only countdown chip. The component subscribes to a 1000ms timer and
 * re-derives `remaining` from `Date.now() - state.deadlineAt`. The server is
 * the authority — we only render what the local clock says, clamped to 0. If
 * the clock reads 0 before the server's forced action arrives, we keep showing
 * "0" so the user understands the timer is up.
 *
 * Visual urgency map:
 *  - default: gray, low-key.
 *  - <30s remaining: amber.
 *  - <10s remaining: red.
 *
 * Renders nothing when `state` is null (timer disabled / game over). The size
 * variant lets parents pick `chip` (default, fits next to a badge) or `mini`
 * (compact dot for the seat chip).
 */
export interface TurnTimerProps {
  state: TurnTimerState | null;
  /**
   * Layout variant.
   *  - `chip` (default): inline pill `12s` with colour background.
   *  - `mini`: bare numeric badge — designed to sit above an avatar.
   */
  variant?: 'chip' | 'mini';
  /** Extra classNames forwarded to the root element. */
  className?: string;
  /** Optional explicit testid override (defaults to `turn-timer`). */
  testId?: string;
}

function pickTone(secondsRemaining: number): {
  bg: string;
  text: string;
  ring: string;
} {
  if (secondsRemaining < 10) {
    return {
      bg: 'bg-red-600',
      text: 'text-white',
      ring: 'ring-red-300/60',
    };
  }
  if (secondsRemaining < 30) {
    return {
      bg: 'bg-amber-500',
      text: 'text-white',
      ring: 'ring-amber-300/60',
    };
  }
  return {
    bg: 'bg-slate-700/80',
    text: 'text-white',
    ring: 'ring-slate-400/30',
  };
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return String(seconds);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function TurnTimer({
  state,
  variant = 'chip',
  className,
  testId = 'turn-timer',
}: TurnTimerProps) {
  const { t } = useTranslation();
  // Local "now" — re-rendered every 1s while the timer is active. We initialise
  // from Date.now() so the very first paint is already accurate.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!state) return;
    // Re-snap immediately so the first interval tick doesn't lag the new state.
    setNow(Date.now());
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [state?.deadlineAt, state?.activeUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) return null;

  const deadlineMs = new Date(state.deadlineAt).getTime();
  const remainingMs = Math.max(0, deadlineMs - now);
  const remainingSec = Math.ceil(remainingMs / 1000);
  const tone = pickTone(remainingSec);

  if (variant === 'mini') {
    return (
      <span
        className={clsx(
          'inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums ring-1',
          tone.bg,
          tone.text,
          tone.ring,
          className,
        )}
        data-testid={testId}
        data-remaining-seconds={remainingSec}
        aria-label={t('game.turnTimer.label')}
        title={t('game.turnTimer.label')}
      >
        {formatSeconds(remainingSec)}
      </span>
    );
  }

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none tabular-nums ring-2',
        tone.bg,
        tone.text,
        tone.ring,
        className,
      )}
      data-testid={testId}
      data-remaining-seconds={remainingSec}
      aria-label={t('game.turnTimer.label')}
      title={t('game.turnTimer.label')}
    >
      {formatSeconds(remainingSec)}
    </span>
  );
}
