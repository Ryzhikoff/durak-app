import clsx from 'clsx';
import type { Card, Suit } from './types';

export type CardSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<CardSize, string> = {
  xs: 'w-8 h-12 text-[10px]',
  sm: 'w-10 h-14 text-xs',
  // md cards bump up noticeably from xl / 2xl so the desktop felt can breathe
  // and table entries / hand cards read at a glance. Tracks the player-hand
  // sizing below.
  md: 'w-14 h-20 text-sm xl:w-24 xl:h-36 xl:text-lg 2xl:w-28 2xl:h-40 2xl:text-xl',
  // lg used by the drag overlay — keep it a touch bigger than xl-md so the
  // floating preview pops above the source card visually.
  lg: 'w-20 h-28 text-base xl:w-28 xl:h-40 xl:text-xl 2xl:w-32 2xl:h-44 2xl:text-2xl',
};

const RANK_LABEL: Record<number, string> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
};

const SUIT_GLYPH: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

const SUIT_COLOR: Record<Suit, string> = {
  spades: 'text-slate-900',
  clubs: 'text-slate-900',
  hearts: 'text-red-600',
  diamonds: 'text-red-600',
};

interface PlayingCardProps {
  card: Card;
  size?: CardSize;
  className?: string;
  /** Visually-only highlighted (selected for action). */
  selected?: boolean;
  /** Visually faded — eg. dragging source ghost in the hand. */
  dimmed?: boolean;
  /** Accessible label override. */
  ariaLabel?: string;
}

/**
 * Pure presentational card face. Works for both `standard` cards (rank+suit)
 * and jokers (color label). The component is style-only — interactivity (drag,
 * drop) is wired by parents via `@dnd-kit`.
 */
export function PlayingCard({
  card,
  size = 'md',
  className,
  selected,
  dimmed,
  ariaLabel,
}: PlayingCardProps) {
  const base = clsx(
    'relative rounded-lg border bg-white select-none flex flex-col justify-between p-1 leading-none transition-shadow',
    'shadow-md',
    SIZE_CLASS[size],
    selected
      ? 'border-accent ring-2 ring-accent -translate-y-1'
      : 'border-slate-300',
    dimmed && !selected ? 'opacity-40' : '',
    className,
  );

  const content =
    card.kind === 'standard' ? (
      <StandardFace card={card} />
    ) : (
      <JokerFace color={card.color} />
    );

  return (
    <div className={base} role="img" aria-label={ariaLabel ?? cardLabel(card)}>
      {content}
    </div>
  );
}

function StandardFace({
  card,
}: {
  card: Extract<Card, { kind: 'standard' }>;
}) {
  const rank = RANK_LABEL[card.rank] ?? String(card.rank);
  const suit = SUIT_GLYPH[card.suit];
  const colorClass = SUIT_COLOR[card.suit];
  return (
    <>
      <div className={clsx('flex items-start gap-0.5 font-bold', colorClass)}>
        <span>{rank}</span>
        <span>{suit}</span>
      </div>
      <div className={clsx('text-center text-xl leading-none', colorClass)}>
        {suit}
      </div>
      <div
        className={clsx(
          'flex items-end justify-end gap-0.5 font-bold rotate-180',
          colorClass,
        )}
      >
        <span>{rank}</span>
        <span>{suit}</span>
      </div>
    </>
  );
}

function JokerFace({ color }: { color: 'red' | 'black' }) {
  const colorClass = color === 'red' ? 'text-red-600' : 'text-slate-900';
  return (
    <>
      <div className={clsx('text-[0.6em] font-bold uppercase', colorClass)}>
        Joker
      </div>
      <div className={clsx('text-center text-base leading-none', colorClass)}>
        ★
      </div>
      <div
        className={clsx(
          'text-right text-[0.6em] font-bold uppercase rotate-180',
          colorClass,
        )}
      >
        Joker
      </div>
    </>
  );
}

function cardLabel(card: Card): string {
  if (card.kind === 'joker') return `Joker (${card.color})`;
  return `${RANK_LABEL[card.rank] ?? card.rank} ${card.suit}`;
}
