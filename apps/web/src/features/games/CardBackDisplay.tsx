import clsx from 'clsx';
import { CUSTOM_CARD_BACK_ID, type CardBackDef } from '@durak/shared-types';
import { CardBack } from '@/components/CardBack';
import { useCardBacks } from '@/features/cardbacks/hooks';

interface CardBackDisplayProps {
  cardBackId: string;
  customCardBackUrl: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  ariaLabel?: string;
}

/**
 * Resolves a player's `cardBackId` (which may be the magic `__custom__` id) to
 * the corresponding visual. Falls back to a neutral placeholder while the
 * definitions are loading or if the id is unknown.
 */
export function CardBackDisplay({
  cardBackId,
  customCardBackUrl,
  size = 'sm',
  className,
  ariaLabel,
}: CardBackDisplayProps) {
  const backs = useCardBacks();

  if (cardBackId === CUSTOM_CARD_BACK_ID && customCardBackUrl) {
    return (
      <CardBack
        mode="custom"
        imageUrl={customCardBackUrl}
        size={size}
        className={className}
        label={ariaLabel}
      />
    );
  }

  const def: CardBackDef | undefined = backs.data?.items.find(
    (b) => b.id === cardBackId,
  );
  if (def) {
    return (
      <CardBack
        mode="preset"
        def={def}
        size={size}
        className={className}
        label={ariaLabel}
      />
    );
  }

  // Loading / unknown id — neutral filler that keeps layout stable.
  return (
    <div
      className={clsx(
        'rounded-xl border border-border bg-surfaceAlt',
        size === 'sm' ? 'w-10 h-14' : size === 'md' ? 'w-16 h-24' : 'w-24 h-36',
        className,
      )}
      role="img"
      aria-label={ariaLabel ?? 'card-back'}
    />
  );
}
