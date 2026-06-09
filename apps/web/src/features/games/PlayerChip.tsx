import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/Avatar';
import { CheatAttemptsBadge } from './OpponentSeat';
import { ReactionBubble } from './ReactionBubble';
import { OpponentCardStack } from './OpponentCardStack';
import type { ClientGamePlayer } from './types';

interface PlayerChipProps {
  player: ClientGamePlayer;
  /** Highlighted as the current attacker. */
  isAttacker: boolean;
  /** Highlighted as the current defender. */
  isDefender: boolean;
  /** True if this chip represents the viewer themself. Adds a gold accent. */
  isMe?: boolean;
  /** Show the per-player cheat attempts badge (when cheatingEnabled). */
  showCheatBadge?: boolean;
  /** Floating reaction emoji bubble. */
  reaction?: { emoji: string; timestamp: string } | null;
  /**
   * Visual variant.
   *  - `'row'` (default) — compact horizontal chip used in the mobile players row.
   *  - `'seat'` — wider, taller chip used inside a radial seat slot (xl+). Adds
   *    the opponent's card-back stack next to the avatar so each opponent's
   *    hand is visible at a glance.
   */
  variant?: 'row' | 'seat';
}

/**
 * Compact single-row player chip used in the new top players strip + the
 * radial-seat layout. `row` is the legacy mobile-first chip; `seat` is the
 * desktop variant that also shows the player's face-down hand stack.
 */
export function PlayerChip({
  player,
  isAttacker,
  isDefender,
  isMe = false,
  showCheatBadge,
  reaction,
  variant = 'row',
}: PlayerChipProps) {
  const { t } = useTranslation();

  const status: string | null = player.isFinished
    ? player.finishPlace != null
      ? `#${player.finishPlace}`
      : null
    : player.isPassed
      ? t('game.opponent.passed')
      : null;

  const isActive = isAttacker || isDefender;
  const pulseClass = isActive
    ? isAttacker
      ? 'player-active-pulse-attacker'
      : 'player-active-pulse-defender'
    : '';

  // Thicker, more distinguishable highlight for the current attacker vs defender.
  // Attacker — red/orange ring + drop-shadow; defender — cyan ring + drop-shadow.
  // The colours intentionally clash so role is readable at a glance even on
  // small mobile chips.
  const borderClass = isAttacker
    ? 'border-red-500 ring-4 ring-red-500/70 shadow-[0_0_18px_rgba(239,68,68,0.55)]'
    : isDefender
      ? 'border-cyan-400 ring-4 ring-cyan-400/70 shadow-[0_0_18px_rgba(34,211,238,0.55)]'
      : isMe
        ? 'border-amber-400/60 ring-1 ring-amber-400/40'
        : 'border-border';

  if (variant === 'seat') {
    return (
      <div
        className={clsx(
          'relative flex w-[160px] flex-col items-center gap-1.5 rounded-2xl border bg-surface/80 px-2 py-2 shadow-lg backdrop-blur-sm transition-all',
          borderClass,
          pulseClass,
          player.isFinished ? 'opacity-60' : '',
        )}
        data-testid={isMe ? `player-self-${player.id}` : `opponent-${player.id}`}
        data-player-id={player.id}
      >
        {reaction ? (
          <ReactionBubble key={reaction.timestamp} emoji={reaction.emoji} />
        ) : null}

        <div className="flex w-full items-center gap-2">
          <Avatar
            src={player.avatarUrl}
            nickname={player.nickname}
            size={48}
            className="shrink-0"
          />
          {!isMe ? (
            <OpponentCardStack
              handSize={player.handSize}
              cardBackId={player.cardBackId}
              customCardBackUrl={player.customCardBackUrl}
              maxVisible={3}
              size="sm"
              ariaLabel={t('game.players.handSizeShort', {
                count: player.handSize,
              })}
            />
          ) : null}
        </div>

        <div className="flex w-full min-w-0 items-center justify-center gap-1">
          <span className="truncate text-sm font-medium leading-tight">
            {player.nickname}
          </span>
        </div>

        <div className="flex items-center gap-1 text-[11px] leading-tight text-textMuted">
          {isMe ? (
            <span className="font-semibold text-amber-400">
              {t('game.players.you')}
            </span>
          ) : (
            <span className="tabular-nums">
              {t('game.players.handSizeShort', { count: player.handSize })}
            </span>
          )}
          {status ? <span>· {status}</span> : null}
        </div>

        {showCheatBadge ? (
          <CheatAttemptsBadge
            remaining={player.cheatAttemptsRemaining}
            ariaLabel={t('game.cheat.attemptsRemaining', {
              count: player.cheatAttemptsRemaining,
            })}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={clsx(
        // `relative` so the floating reaction bubble can anchor to the chip.
        'relative flex w-[76px] shrink-0 flex-col items-center gap-1 rounded-xl border bg-surface p-1.5 transition-all md:w-[96px] md:p-2',
        borderClass,
        pulseClass,
        player.isFinished ? 'opacity-60' : '',
      )}
      data-testid={isMe ? `player-self-${player.id}` : `opponent-${player.id}`}
      data-player-id={player.id}
    >
      {reaction ? (
        <ReactionBubble key={reaction.timestamp} emoji={reaction.emoji} />
      ) : null}

      <Avatar
        src={player.avatarUrl}
        nickname={player.nickname}
        size={28}
        className="md:!h-10 md:!w-10"
      />

      <div className="flex w-full items-center justify-center gap-1">
        <span className="truncate text-[11px] font-medium leading-tight md:text-xs">
          {player.nickname}
        </span>
      </div>

      <div className="flex items-center gap-1 text-[10px] leading-tight text-textMuted">
        {isMe ? (
          <span className="font-semibold text-amber-400">{t('game.players.you')}</span>
        ) : (
          <span className="tabular-nums">
            {t('game.players.handSizeShort', { count: player.handSize })}
          </span>
        )}
        {status ? <span>· {status}</span> : null}
      </div>

      {showCheatBadge ? (
        <CheatAttemptsBadge
          remaining={player.cheatAttemptsRemaining}
          ariaLabel={t('game.cheat.attemptsRemaining', {
            count: player.cheatAttemptsRemaining,
          })}
        />
      ) : null}
    </div>
  );
}
