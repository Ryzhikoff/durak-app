import { useMemo } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { CardBackDisplay } from './CardBackDisplay';
import { PlayingCard } from './PlayingCard';
import type { Card as PlayingCardType, Suit } from './types';

/** Default card-back id used for the "communal" deck (not the viewer's pref). */
const DECK_CARD_BACK_ID = 'classic-1';

interface DeckStackProps {
  deckSize: number;
  trumpCard: PlayingCardType | null;
  trumpSuit: Suit | null;
  /**
   * Compact mobile mode — smaller card sizes + tighter offsets so the stack
   * fits horizontally above the table on narrow screens.
   */
  variant?: 'desktop' | 'mobile';
  className?: string;
}

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

/**
 * Compute how many face-down card backs to render given the real deck size.
 * Caps the stack so we never spend layout on dozens of overlapping cards while
 * still surfacing "this is a deeper deck" visually.
 */
function visibleStackSize(deckSize: number): number {
  if (deckSize <= 0) return 0;
  if (deckSize <= 2) return deckSize;
  if (deckSize <= 5) return 3;
  if (deckSize <= 11) return 5;
  return 7;
}

/**
 * Communal-deck visual: a small stack of face-down card backs with the trump
 * card laid perpendicular beneath/behind it (the classic Durak deal layout).
 *
 * The stack thins out as the deck drains. When the deck hits zero the stack
 * disappears entirely and the trump card fades to ~40% opacity — still on the
 * table so the player can see which suit beats which, but visually "spent".
 *
 * Card-back id is hard-coded to `classic-1` because the deck doesn't belong to
 * any one player — it's the table's deck.
 */
export function DeckStack({
  deckSize,
  trumpCard,
  trumpSuit,
  variant = 'desktop',
  className,
}: DeckStackProps) {
  const { t } = useTranslation();
  const visible = useMemo(() => visibleStackSize(deckSize), [deckSize]);
  const isEmpty = deckSize <= 0;

  // Per-variant sizing. Numbers chosen so the trump card (rotated 90°) tucks
  // cleanly under the stack with a small overhang on the side — visually
  // matching the way a deck is dealt with the trump turned sideways at the
  // bottom of the pile.
  const dims = variant === 'desktop'
    ? {
        cardW: 56, // matches PlayingCard md base (mobile-ish since the deck
        cardH: 80, //   sits in a side slot, not the player's hand)
        stepX: 2,
        stepY: 2,
        backSize: 'md' as const,
        trumpSize: 'md' as const,
      }
    : {
        cardW: 40,
        cardH: 56,
        stepX: 2,
        stepY: 2,
        backSize: 'sm' as const,
        trumpSize: 'sm' as const,
      };

  // The trump card lies horizontally and pokes out from beneath the bottom of
  // the stack. We allocate enough box height to fit both. With visible=0 the
  // stack collapses to zero height so the trump card sits on its own.
  const stackBoxW = visible > 0 ? dims.cardW + dims.stepX * (visible - 1) : 0;
  const stackBoxH = visible > 0 ? dims.cardH + dims.stepY * (visible - 1) : 0;
  // Rotated card occupies cardH (width) x cardW (height) after rotation; we
  // overlap roughly half of it under the stack so it visibly emerges below.
  const rotatedW = dims.cardH;
  const rotatedH = dims.cardW;
  const trumpOverhang = Math.round(rotatedH * 0.55);
  // The wrapping box has to hold the stack + the protruding part of the trump.
  // When the stack is empty the trump card alone defines the box size.
  const boxW = Math.max(stackBoxW, rotatedW);
  const boxH =
    visible > 0 ? stackBoxH + (rotatedH - trumpOverhang) : rotatedH;

  const ariaLabel = isEmpty
    ? t('game.deck.empty')
    : t('game.deck.count', { count: deckSize });

  return (
    <div
      className={clsx(
        'flex flex-col items-center gap-1 select-none',
        className,
      )}
      data-testid="deck-stack"
      aria-label={t('game.deck.title')}
      role="group"
    >
      <div
        className="relative"
        style={{ width: boxW, height: boxH }}
        aria-label={ariaLabel}
        data-testid="deck-stack-box"
      >
        {/* Trump card lies perpendicular UNDER the stack. We render it first
            so the face-down backs above sit on top in z-order. With deck=0
            the stack vanishes and the trump is the only visible artefact. */}
        {trumpCard ? (
          <div
            className={clsx(
              'absolute left-1/2 -translate-x-1/2 transition-opacity duration-500',
              isEmpty ? 'opacity-40' : 'opacity-100',
            )}
            style={{
              // With an empty deck the trump sits at the top of the box;
              // otherwise it tucks under the stack with `trumpOverhang` of
              // overlap so the rotated card visibly emerges below.
              top: visible > 0 ? stackBoxH - trumpOverhang : 0,
              width: rotatedW,
              height: rotatedH,
            }}
            data-testid="deck-trump-card"
          >
            <div
              className="origin-center"
              style={{
                transform: 'rotate(90deg)',
                width: dims.cardW,
                height: dims.cardH,
                position: 'absolute',
                left: (rotatedW - dims.cardW) / 2,
                top: (rotatedH - dims.cardH) / 2,
              }}
            >
              <PlayingCard card={trumpCard} size={dims.trumpSize} />
            </div>
          </div>
        ) : trumpSuit ? (
          // Engine knows the trump suit but the original card isn't surfaced
          // — show a small suit glyph badge as a reminder.
          <div
            className={clsx(
              'absolute left-1/2 -translate-x-1/2 flex items-center justify-center rounded border border-slate-300 bg-white text-base shadow',
              SUIT_COLOR[trumpSuit],
              isEmpty ? 'opacity-40' : 'opacity-100',
            )}
            style={{
              top:
                visible > 0
                  ? stackBoxH - Math.round(trumpOverhang / 2)
                  : 0,
              width: 28,
              height: 28,
            }}
            data-testid="deck-trump-glyph"
            aria-label={t('game.info.trumpLabel')}
          >
            {SUIT_GLYPH[trumpSuit]}
          </div>
        ) : null}

        {/* Face-down stack — staggered by (stepX, stepY) so depth is visible.
            Rendered after the trump so it draws on top. */}
        <div
          className="absolute left-1/2 top-0 -translate-x-1/2 transition-[height] duration-300"
          style={{ width: stackBoxW, height: stackBoxH }}
          data-testid="deck-stack-cards"
        >
          {Array.from({ length: visible }).map((_, i) => (
            <div
              key={i}
              className="absolute"
              style={{ left: i * dims.stepX, top: i * dims.stepY }}
            >
              <CardBackDisplay
                cardBackId={DECK_CARD_BACK_ID}
                customCardBackUrl={null}
                size={dims.backSize}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Count label / empty caption. tabular-nums so digits don't jitter as
          cards are dealt out. */}
      <div
        className="text-[10px] font-medium tabular-nums text-textMuted"
        data-testid="deck-stack-count"
      >
        {isEmpty
          ? t('game.deck.empty')
          : t('game.deck.count', { count: deckSize })}
      </div>
    </div>
  );
}
