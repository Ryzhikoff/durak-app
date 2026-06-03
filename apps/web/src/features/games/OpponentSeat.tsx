import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
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
          <div className="truncate text-xs font-medium leading-tight">
            {player.nickname}
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
