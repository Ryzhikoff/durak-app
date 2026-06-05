/**
 * Ephemeral floating emoji bubble for in-game seat reactions. Sits absolutely
 * positioned above the parent (an `OpponentSeat` or the player's own hand row);
 * the parent owns the relative-positioned anchor.
 *
 * Rendering contract:
 *  - `emoji=null` => render nothing.
 *  - Otherwise the bubble fades up + out over ~2.5s via the inline keyframe.
 *  - The parent re-keys the component via `key={timestamp}` so that the same
 *    user tapping the same emoji twice in a row still re-triggers the animation.
 *  - `pointer-events: none` so the bubble never blocks taps on the seat / cards
 *    underneath it.
 */
import { PLAYER_REACTION_BUBBLE_TTL_MS } from '@durak/shared-types';

interface ReactionBubbleProps {
  emoji: string | null;
  /** Optional override for the float duration. Defaults to the shared constant. */
  durationMs?: number;
  className?: string;
}

export function ReactionBubble({
  emoji,
  durationMs = PLAYER_REACTION_BUBBLE_TTL_MS,
  className,
}: ReactionBubbleProps) {
  if (!emoji) return null;
  return (
    <span
      className={`reaction-bubble pointer-events-none absolute left-1/2 -top-1 z-20 -translate-x-1/2 select-none text-3xl ${className ?? ''}`}
      style={{ animationDuration: `${durationMs}ms` }}
      aria-hidden
      data-testid="reaction-bubble"
    >
      {emoji}
    </span>
  );
}
