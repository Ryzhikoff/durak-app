import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Flag } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { CardBackDisplay } from './CardBackDisplay';
import type { ClientGamePlayer } from './types';

interface OpponentSeatProps {
  player: ClientGamePlayer;
  /** Highlighted as the current attacker. */
  isAttacker: boolean;
  /** Highlighted as the current defender. */
  isDefender: boolean;
  className?: string;
  /** Compact mode for side-seats. */
  compact?: boolean;
  /**
   * If true, render a small badge showing remaining cheat attempts. Controlled
   * by the parent (only enabled when the current game has cheatingEnabled).
   */
  showCheatBadge?: boolean;
}

/**
 * Card showing one opponent: avatar + nickname + a stack of `handSize` face-down
 * cards. Highlights ring when attacking / defending so the player can tell
 * whose turn it is at a glance.
 */
export function OpponentSeat({
  player,
  isAttacker,
  isDefender,
  className,
  compact,
  showCheatBadge,
}: OpponentSeatProps) {
  const { t } = useTranslation();
  // Cap visible face-downs to keep layout from blowing up at e.g. handSize=24.
  const shown = Math.min(player.handSize, compact ? 4 : 6);
  const overflow = player.handSize - shown;

  const status = player.isFinished
    ? player.finishPlace != null
      ? `#${player.finishPlace}`
      : null
    : player.isPassed
      ? t('game.opponent.passed')
      : null;

  return (
    <div
      className={clsx(
        'flex flex-col items-center gap-1 rounded-xl border bg-surface p-2',
        isAttacker
          ? 'border-warning ring-1 ring-warning'
          : isDefender
            ? 'border-accent ring-1 ring-accent'
            : 'border-border',
        player.isFinished ? 'opacity-60' : '',
        className,
      )}
      data-testid={`opponent-${player.id}`}
    >
      <div className="flex items-center gap-2">
        <Avatar
          src={player.avatarUrl}
          nickname={player.nickname}
          size={compact ? 24 : 32}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium leading-tight">
              {player.nickname}
            </span>
            {showCheatBadge ? (
              <CheatAttemptsBadge
                remaining={player.cheatAttemptsRemaining}
                ariaLabel={t('game.cheat.attemptsRemaining', {
                  count: player.cheatAttemptsRemaining,
                })}
              />
            ) : null}
          </div>
          <div className="text-[10px] leading-tight text-textMuted">
            {t('game.opponent.cardsCount', { count: player.handSize })}
            {status ? ` · ${status}` : ''}
          </div>
        </div>
      </div>
      {player.handSize > 0 ? (
        <div className="relative flex h-10 items-end justify-center">
          {Array.from({ length: shown }).map((_, i) => (
            <CardBackDisplay
              key={i}
              cardBackId={player.cardBackId}
              customCardBackUrl={player.customCardBackUrl}
              size="sm"
              className="-ml-6 first:ml-0"
              ariaLabel={`${player.nickname} card ${i + 1}`}
            />
          ))}
          {overflow > 0 ? (
            <div className="ml-1 text-[10px] text-textMuted">+{overflow}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface CheatAttemptsBadgeProps {
  remaining: number;
  ariaLabel: string;
}

/**
 * Tiny pill showing the player's remaining per-game cheat attempts. Coloured
 * grey when the player has exhausted their pool (visually "spent"), and green
 * while they still have charges left. Mobile-first sizing: only ~14px tall so
 * it fits inline next to the nickname.
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
