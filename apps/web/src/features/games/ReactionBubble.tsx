/**
 * Ephemeral floating bubble for in-game seat reactions — emoji OR text. Sits
 * absolutely positioned above the parent (an `OpponentSeat` or the player's
 * own hand row); the parent owns the relative-positioned anchor.
 *
 * Rendering contract:
 *  - `emoji=null` (default mode) => render nothing.
 *  - When `text` is supplied (and non-empty), the bubble switches to text
 *    mode: a wrapping pill with surface background. Text mode ignores `emoji`
 *    so callers can mount two bubbles (emoji + text) on the same anchor with
 *    a sibling offset.
 *  - In either mode the bubble fades up + out over ~2.5s via the inline
 *    keyframe.
 *  - The parent re-keys the component via `key={timestamp}` so a repeated
 *    reaction still re-triggers the animation.
 *  - `pointer-events: none` so the bubble never blocks taps on the seat /
 *    cards underneath it.
 */
import { PLAYER_REACTION_BUBBLE_TTL_MS } from '@durak/shared-types';

interface ReactionBubbleProps {
  emoji?: string | null;
  /** Optional text body — when provided, renders a pill instead of an emoji. */
  text?: string | null;
  /** Optional override for the float duration. Defaults to the shared constant. */
  durationMs?: number;
  className?: string;
}

export function ReactionBubble({
  emoji = null,
  text = null,
  durationMs = PLAYER_REACTION_BUBBLE_TTL_MS,
  className,
}: ReactionBubbleProps) {
  if (text) {
    return (
      <span
        className={`reaction-bubble pointer-events-none absolute left-1/2 -top-2 z-20 max-w-[16rem] -translate-x-1/2 select-none whitespace-normal break-words rounded-full border border-border bg-surface px-3 py-1 text-center text-sm font-medium leading-tight text-text shadow-lg md:max-w-[18rem] md:px-4 md:py-1.5 md:text-base ${className ?? ''}`}
        style={{ animationDuration: `${durationMs}ms` }}
        data-testid="text-reaction-bubble"
      >
        {text}
      </span>
    );
  }
  if (!emoji) return null;
  return (
    <span
      className={`reaction-bubble pointer-events-none absolute left-1/2 -top-2 z-20 -translate-x-1/2 select-none text-6xl xl:text-7xl ${className ?? ''}`}
      style={{ animationDuration: `${durationMs}ms` }}
      aria-hidden
      data-testid="reaction-bubble"
    >
      {emoji}
    </span>
  );
}
