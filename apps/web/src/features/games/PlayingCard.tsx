import clsx from 'clsx';
import { useContext, useMemo } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import type { FaceCardAsset, FaceCardRank } from '@durak/shared-types';
import type { Card, Suit } from './types';
import { useFaceCardAssets } from './hooks';

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

/** Hex used inside SVG silhouettes so they pick the correct ink for the suit. */
const SUIT_HEX: Record<Suit, string> = {
  spades: '#0f172a',
  clubs: '#0f172a',
  hearts: '#dc2626',
  diamonds: '#dc2626',
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
 *
 * Standard faces use a classic Bicycle-style pip grid for 6..10, a centred
 * suit glyph for Aces, and either an admin-uploaded image (when present) or a
 * built-in SVG silhouette for Jacks, Queens, and Kings.
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

/**
 * Read the face-card asset map without crashing when the component is rendered
 * outside of a QueryClientProvider — several existing test suites (PlayerHand,
 * DeckStack, GameTable) instantiate `PlayingCard` directly with no provider in
 * scope. In that case there are simply no overrides; the renderer falls back
 * to the default SVG silhouette like it would for an empty list.
 *
 * The QueryClient presence is stable per component instance (a provider never
 * appears or disappears mid-tree in this app), so the conditional hook call
 * is safe in practice — every re-render of the same `<PlayingCard>` instance
 * takes the same branch.
 */
function useFaceCardAssetsSafe(): FaceCardAsset[] | undefined {
  const client = useContext(QueryClientContext);
  if (!client) return undefined;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useFaceCardAssets().data;
}

function StandardFace({
  card,
}: {
  card: Extract<Card, { kind: 'standard' }>;
}) {
  const rank = RANK_LABEL[card.rank] ?? String(card.rank);
  const suit = SUIT_GLYPH[card.suit];
  const colorClass = SUIT_COLOR[card.suit];
  const assets = useFaceCardAssetsSafe();
  const faceRank = numericRankToFaceRank(card.rank);
  const uploaded = useMemo<FaceCardAsset | undefined>(() => {
    if (!faceRank || !assets) return undefined;
    return assets.find(
      (a) => a.rank === faceRank && a.suit === card.suit && a.url,
    );
  }, [assets, faceRank, card.suit]);

  return (
    <>
      <div
        className={clsx('flex items-start gap-0.5 font-bold', colorClass)}
        aria-hidden="true"
      >
        <span>{rank}</span>
        <span>{suit}</span>
      </div>
      <div
        className="absolute inset-0 flex items-center justify-center px-1.5 py-4"
        aria-hidden="true"
        data-testid="card-center"
      >
        <CardCenter card={card} faceRank={faceRank} uploaded={uploaded} />
      </div>
      <div
        className={clsx(
          'flex items-end justify-end gap-0.5 font-bold rotate-180',
          colorClass,
        )}
        aria-hidden="true"
      >
        <span>{rank}</span>
        <span>{suit}</span>
      </div>
    </>
  );
}

function CardCenter({
  card,
  faceRank,
  uploaded,
}: {
  card: Extract<Card, { kind: 'standard' }>;
  faceRank: FaceCardRank | null;
  uploaded: FaceCardAsset | undefined;
}) {
  // Ace — single oversized suit glyph in the centre.
  if (card.rank === 14) {
    return (
      <span
        className={clsx('text-3xl xl:text-5xl 2xl:text-6xl', SUIT_COLOR[card.suit])}
        data-testid="card-ace-symbol"
      >
        {SUIT_GLYPH[card.suit]}
      </span>
    );
  }
  // J/Q/K — admin upload wins, otherwise built-in silhouette SVG.
  if (faceRank) {
    if (uploaded?.url) {
      return (
        <img
          src={uploaded.url}
          alt=""
          className="absolute inset-1.5 h-[calc(100%-12px)] w-[calc(100%-12px)] rounded-md object-cover"
          data-testid="card-face-image"
        />
      );
    }
    return (
      <FaceCardSilhouette
        rank={faceRank}
        suit={card.suit}
        data-testid={`card-face-svg-${faceRank}`}
      />
    );
  }
  // Numeric pip-grid (6..10).
  const pipCount = clampPipCount(card.rank);
  if (pipCount === 0) return null;
  return (
    <PipGrid count={pipCount} suit={card.suit} data-testid="card-pip-grid" />
  );
}

/**
 * Map a numeric rank to the slug used for face-card assets. Returns `null`
 * for everything else (numbers + ace).
 */
function numericRankToFaceRank(rank: number): FaceCardRank | null {
  if (rank === 11) return 'jack';
  if (rank === 12) return 'queen';
  if (rank === 13) return 'king';
  return null;
}

/**
 * Defensive clamp — engine ranks are typed 2..14 but a forward-compat client
 * should never crash on an unexpected value (e.g. a 5-card extension).
 */
function clampPipCount(rank: number): number {
  if (rank < 2 || rank > 10) return 0;
  return rank;
}

/**
 * Classic Bicycle-style pip layout for ranks 2..10. The grid is anchored to
 * the centre of the card; halves of the layout are mirrored top/bottom by
 * applying `rotate-180` to the second half via the `down` flag. Positions are
 * normalised to a 4 × 7 percentage grid so any card size inherits the same
 * visual rhythm.
 */
const PIP_LAYOUTS: Record<number, Array<{ left: number; top: number; down?: boolean }>> = {
  2: [
    { left: 50, top: 12 },
    { left: 50, top: 88, down: true },
  ],
  3: [
    { left: 50, top: 12 },
    { left: 50, top: 50 },
    { left: 50, top: 88, down: true },
  ],
  4: [
    { left: 28, top: 14 },
    { left: 72, top: 14 },
    { left: 28, top: 86, down: true },
    { left: 72, top: 86, down: true },
  ],
  5: [
    { left: 28, top: 14 },
    { left: 72, top: 14 },
    { left: 50, top: 50 },
    { left: 28, top: 86, down: true },
    { left: 72, top: 86, down: true },
  ],
  6: [
    { left: 28, top: 12 },
    { left: 72, top: 12 },
    { left: 28, top: 50 },
    { left: 72, top: 50 },
    { left: 28, top: 88, down: true },
    { left: 72, top: 88, down: true },
  ],
  7: [
    { left: 28, top: 10 },
    { left: 72, top: 10 },
    { left: 50, top: 30 },
    { left: 28, top: 50 },
    { left: 72, top: 50 },
    { left: 28, top: 90, down: true },
    { left: 72, top: 90, down: true },
  ],
  8: [
    { left: 28, top: 10 },
    { left: 72, top: 10 },
    { left: 50, top: 30 },
    { left: 28, top: 50 },
    { left: 72, top: 50 },
    { left: 50, top: 70, down: true },
    { left: 28, top: 90, down: true },
    { left: 72, top: 90, down: true },
  ],
  9: [
    { left: 28, top: 10 },
    { left: 72, top: 10 },
    { left: 28, top: 33 },
    { left: 72, top: 33 },
    { left: 50, top: 50 },
    { left: 28, top: 67, down: true },
    { left: 72, top: 67, down: true },
    { left: 28, top: 90, down: true },
    { left: 72, top: 90, down: true },
  ],
  10: [
    { left: 28, top: 10 },
    { left: 72, top: 10 },
    { left: 50, top: 25 },
    { left: 28, top: 38 },
    { left: 72, top: 38 },
    { left: 28, top: 62, down: true },
    { left: 72, top: 62, down: true },
    { left: 50, top: 75, down: true },
    { left: 28, top: 90, down: true },
    { left: 72, top: 90, down: true },
  ],
};

function PipGrid({
  count,
  suit,
  ...rest
}: {
  count: number;
  suit: Suit;
} & React.HTMLAttributes<HTMLDivElement>) {
  const layout = PIP_LAYOUTS[count] ?? [];
  const colorClass = SUIT_COLOR[suit];
  const glyph = SUIT_GLYPH[suit];
  return (
    <div className="relative h-full w-full" {...rest}>
      {layout.map((p, i) => (
        <span
          key={i}
          data-testid="card-pip"
          className={clsx(
            'absolute -translate-x-1/2 -translate-y-1/2 text-[0.95em] xl:text-2xl 2xl:text-3xl leading-none',
            colorClass,
            p.down ? 'rotate-180' : '',
          )}
          style={{ left: `${p.left}%`, top: `${p.top}%` }}
        >
          {glyph}
        </span>
      ))}
    </div>
  );
}

/**
 * Default in-app SVG silhouette for a face card (Jack/Queen/King). Stylised,
 * deliberately abstract — a coloured panel with a crown / sword glyph and the
 * suit symbol stamped on a banner. The intent is to read as "a fancy figure
 * card" at any size, not to imitate Bicycle artwork pixel-for-pixel.
 *
 * Three internal silhouettes (`J`, `Q`, `K`) all share the same outer frame
 * and suit-tint pipeline; the rank glyph + crown count varies.
 */
function FaceCardSilhouette({
  rank,
  suit,
  ...rest
}: {
  rank: FaceCardRank;
  suit: Suit;
} & React.SVGAttributes<SVGSVGElement>) {
  const inkPrimary = SUIT_HEX[suit];
  const inkSoft = suit === 'hearts' || suit === 'diamonds' ? '#fecaca' : '#cbd5e1';
  const inkAccent = suit === 'hearts' || suit === 'diamonds' ? '#b91c1c' : '#1e293b';
  return (
    <svg
      viewBox="0 0 100 140"
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      aria-hidden="true"
      {...rest}
    >
      {/* Panel background — soft suit-tinted backdrop. */}
      <rect x="6" y="6" width="88" height="128" rx="6" fill={inkSoft} opacity="0.45" />
      <rect
        x="6"
        y="6"
        width="88"
        height="128"
        rx="6"
        fill="none"
        stroke={inkAccent}
        strokeOpacity="0.4"
        strokeWidth="1"
      />

      {/* Head + shoulders silhouette shared across all face cards. */}
      <g fill={inkAccent}>
        <ellipse cx="50" cy="58" rx="16" ry="18" />
        <path d="M28 110 Q50 78 72 110 L72 124 L28 124 Z" />
      </g>

      {/* Rank-specific accent atop the head. */}
      {rank === 'king' ? <KingCrown cx={50} cy={36} ink={inkPrimary} /> : null}
      {rank === 'queen' ? <QueenCrown cx={50} cy={36} ink={inkPrimary} /> : null}
      {rank === 'jack' ? <JackHat cx={50} cy={36} ink={inkPrimary} /> : null}

      {/* Suit emblem badge in the lower banner. */}
      <g transform="translate(50 100)">
        <circle r="14" fill="white" stroke={inkAccent} strokeOpacity="0.6" strokeWidth="1" />
        <SuitGlyph suit={suit} ink={inkPrimary} />
      </g>
    </svg>
  );
}

function KingCrown({ cx, cy, ink }: { cx: number; cy: number; ink: string }) {
  // Classic 3-spike crown.
  return (
    <g fill={ink}>
      <path
        d={`M${cx - 18} ${cy + 6} L${cx - 18} ${cy - 6} L${cx - 8} ${cy + 2} L${cx} ${cy - 10} L${cx + 8} ${cy + 2} L${cx + 18} ${cy - 6} L${cx + 18} ${cy + 6} Z`}
      />
      <rect x={cx - 18} y={cy + 6} width="36" height="3" />
      <circle cx={cx - 14} cy={cy - 8} r="1.6" />
      <circle cx={cx} cy={cy - 12} r="1.6" />
      <circle cx={cx + 14} cy={cy - 8} r="1.6" />
    </g>
  );
}

function QueenCrown({ cx, cy, ink }: { cx: number; cy: number; ink: string }) {
  // Rounded tiara with three jewels.
  return (
    <g fill={ink}>
      <path
        d={`M${cx - 18} ${cy + 6} Q${cx - 16} ${cy - 8} ${cx - 8} ${cy - 4} Q${cx - 4} ${cy - 12} ${cx} ${cy - 6} Q${cx + 4} ${cy - 12} ${cx + 8} ${cy - 4} Q${cx + 16} ${cy - 8} ${cx + 18} ${cy + 6} Z`}
      />
      <circle cx={cx - 10} cy={cy - 1} r="1.8" fill="white" />
      <circle cx={cx} cy={cy - 5} r="2" fill="white" />
      <circle cx={cx + 10} cy={cy - 1} r="1.8" fill="white" />
    </g>
  );
}

function JackHat({ cx, cy, ink }: { cx: number; cy: number; ink: string }) {
  // Jester-style cap with a single bell at the tip.
  return (
    <g fill={ink}>
      <path
        d={`M${cx - 16} ${cy + 6} L${cx + 16} ${cy + 6} L${cx + 4} ${cy - 12} Z`}
      />
      <circle cx={cx + 4} cy={cy - 12} r="2.6" fill="white" stroke={ink} strokeWidth="1" />
    </g>
  );
}

function SuitGlyph({ suit, ink }: { suit: Suit; ink: string }) {
  // Tight-fit SVG paths centered on (0,0). Each shape is scaled to fit a 14px
  // circle from `FaceCardSilhouette`. Inline so the renderer doesn't depend
  // on external icon libs.
  switch (suit) {
    case 'hearts':
      return (
        <path
          d="M0 5 C -4 0 -8 -2 -8 -5 A 4 4 0 0 1 0 -5 A 4 4 0 0 1 8 -5 C 8 -2 4 0 0 5 Z"
          fill={ink}
        />
      );
    case 'diamonds':
      return <path d="M0 -8 L8 0 L0 8 L-8 0 Z" fill={ink} />;
    case 'spades':
      return (
        <g fill={ink}>
          <path d="M0 -8 C 5 -2 8 1 8 4 A 4 4 0 0 1 1 4 L 2 7 L -2 7 L -1 4 A 4 4 0 0 1 -8 4 C -8 1 -5 -2 0 -8 Z" />
        </g>
      );
    case 'clubs':
      return (
        <g fill={ink}>
          <circle cx="0" cy="-4" r="3.5" />
          <circle cx="-4" cy="2" r="3.5" />
          <circle cx="4" cy="2" r="3.5" />
          <path d="M -1 4 L 1 4 L 2 8 L -2 8 Z" />
        </g>
      );
  }
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
