import clsx from 'clsx';
import { Flag } from 'lucide-react';

interface CheatAttemptsBadgeProps {
  remaining: number;
  ariaLabel: string;
}

/**
 * Tiny pill showing the player's remaining per-game cheat attempts. Coloured
 * grey when the player has exhausted their pool (visually "spent"), and green
 * while they still have charges left. Mobile-first sizing: only ~14px tall so
 * it fits inline next to the nickname.
 *
 * NOTE: this file used to also export `<OpponentSeat>` — the old corner-grid
 * seat card. The new top players-row layout (see `PlayerChip.tsx` +
 * `GamePage.tsx`) replaced it; the badge is kept here as the only consumer of
 * the existing import path and to keep its tests stable.
 */
export function CheatAttemptsBadge({
  remaining,
  ariaLabel,
}: CheatAttemptsBadgeProps) {
  const active = remaining > 0;
  return (
    <span
      aria-label={ariaLabel}
      title={ariaLabel}
      data-testid="cheat-attempts-badge"
      className={clsx(
        'inline-flex h-[14px] items-center gap-0.5 rounded-full px-1 text-[9px] font-semibold leading-none',
        active
          ? 'bg-emerald-600/20 text-emerald-400 ring-1 ring-emerald-500/40'
          : 'bg-surfaceAlt text-textMuted ring-1 ring-border',
      )}
    >
      <Flag className="h-2.5 w-2.5" aria-hidden />
      <span className="tabular-nums">{remaining}</span>
    </span>
  );
}
