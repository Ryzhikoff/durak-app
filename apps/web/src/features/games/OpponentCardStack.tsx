import clsx from 'clsx';
import { CardBackDisplay } from './CardBackDisplay';

interface OpponentCardStackProps {
  /** Number of cards in the opponent's hand. */
  handSize: number;
  cardBackId: string;
  customCardBackUrl: string | null;
  /** Stack visual density — controls how many overlapping backs we render. */
  maxVisible?: number;
  /** Per-card back size. */
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel?: string;
}

/**
 * Small overlapping stack of card backs shown next to an opponent's avatar in
 * the radial-seat layout. We cap the visible stack at `maxVisible` cards and
 * surface the real count via a tiny "+N" badge when there are more.
 *
 * Each back is the player's chosen `cardBackId` (or their custom upload), so
 * the table actually shows whose cards belong to whom.
 */
export function OpponentCardStack({
  handSize,
  cardBackId,
  customCardBackUrl,
  maxVisible = 3,
  size = 'sm',
  className,
  ariaLabel,
}: OpponentCardStackProps) {
  if (handSize <= 0) {
    return (
      <div
        className={clsx(
          'flex items-center justify-center text-[10px] text-textMuted',
          className,
        )}
        aria-label={ariaLabel}
      >
        —
      </div>
    );
  }

  // Visible backs — capped, but we always render at least one even when handSize=1.
  const visible = Math.min(handSize, maxVisible);
  // Stack offset chosen empirically so a 3-card stack fits within ~36px width.
  const stepX = size === 'sm' ? 6 : 9;
  const stepY = size === 'sm' ? 2 : 3;
  // Width of a single card back (matches CardBackDisplay's sizeClassMap entries).
  const cardWidth = size === 'sm' ? 40 : 64;
  const cardHeight = size === 'sm' ? 56 : 96;
  // Stack box has to fit the offset rightmost card.
  const boxWidth = cardWidth + stepX * (visible - 1);
  const boxHeight = cardHeight + stepY * (visible - 1);

  return (
    <div
      className={clsx('relative shrink-0', className)}
      style={{ width: boxWidth, height: boxHeight }}
      aria-label={ariaLabel}
      data-testid="opponent-card-stack"
    >
      {Array.from({ length: visible }).map((_, i) => (
        <div
          key={i}
          className="absolute"
          style={{ left: i * stepX, top: i * stepY }}
        >
          <CardBackDisplay
            cardBackId={cardBackId}
            customCardBackUrl={customCardBackUrl}
            size={size}
          />
        </div>
      ))}
      {handSize > maxVisible ? (
        <span
          className="absolute -bottom-1 -right-1 inline-flex h-4 min-w-[18px] items-center justify-center rounded-full bg-bg/90 px-1 text-[9px] font-bold leading-none text-text shadow ring-1 ring-border"
          aria-hidden
        >
          +{handSize - maxVisible}
        </span>
      ) : null}
    </div>
  );
}
