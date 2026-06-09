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
   * Compact mobile mode — kept on the props for API compatibility, though the
   * card size is now fully responsive (see `RESPONSIVE_VARS` below) and matches
   * the player-hand `PlayingCard` md sizing on every breakpoint. The variant
   * only affects the parent layout slot (mobile sits in the strip, desktop is
   * pinned to the felt edge).
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
 * CSS variables driving every absolute-positioned dimension inside the stack.
 * The pixel values are kept in lock-step with the `md` size in `PlayingCard`
 * (`w-14 h-20 xl:w-24 xl:h-36 2xl:w-28 2xl:h-40`) so a face-down back rendered
 * here is the exact same physical size as a card sitting in the player's hand
 * or on the felt. Step grows slightly on bigger viewports so the deck looks
 * "thicker" at desktop scale.
 *
 * We use CSS vars (not raw Tailwind w-/h- classes) because the stack and the
 * rotated trump card need their sizes inside `style.calc(...)` expressions —
 * Tailwind classes alone don't compose into arithmetic.
 */
const RESPONSIVE_VARS = [
  // Card size matches PlayingCard `md` exactly: 14×20 → 24×36 → 28×40 rem-units.
  '[--deck-card-w:3.5rem]', // 56px (w-14)
  '[--deck-card-h:5rem]', //   80px (h-20)
  '[--deck-step:2px]',
  'xl:[--deck-card-w:6rem]', // 96px (w-24)
  'xl:[--deck-card-h:9rem]', // 144px (h-36)
  'xl:[--deck-step:3px]',
  '2xl:[--deck-card-w:7rem]', // 112px (w-28)
  '2xl:[--deck-card-h:10rem]', // 160px (h-40)
  '2xl:[--deck-step:4px]',
].join(' ');

/** Shorthand for inline `calc()` against the card-size vars. */
const CW = 'var(--deck-card-w)';
const CH = 'var(--deck-card-h)';
const STEP = 'var(--deck-step)';
/**
 * How deep the rotated trump card slides UNDER the stack — the smaller this
 * value, the more of the trump card stays visible below the pile. At 0.20 only
 * the trump's narrow top strip is covered; ~80% of its short side pokes out so
 * the rank + suit and the central glyph are both clearly readable.
 */
const TRUMP_OVERHANG = `calc(${CW} * 0.20)`;

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

  // Express every box dimension as a CSS `calc()` against the responsive vars.
  // `visible - 1` is clamped to 0 so an empty stack collapses cleanly.
  const stackBoxW =
    visible > 0 ? `calc(${CW} + ${STEP} * ${visible - 1})` : '0px';
  const stackBoxH =
    visible > 0 ? `calc(${CH} + ${STEP} * ${visible - 1})` : '0px';
  // After rotate(90deg) the trump card's bounding box swaps W/H.
  const rotatedW = CH;
  const rotatedH = CW;
  // The wrapping box must cover both the stack and the protruding trump tail.
  // CSS max() handles the case where the rotated trump is wider than the stack.
  const boxW = visible > 0 ? `max(${stackBoxW}, ${rotatedW})` : rotatedW;
  const boxH =
    visible > 0
      ? `calc(${stackBoxH} + ${rotatedH} - ${TRUMP_OVERHANG})`
      : rotatedH;
  // Top offset for the trump card: tucked under the bottom of the stack, or
  // pinned to the top when the stack is empty.
  const trumpTop =
    visible > 0 ? `calc(${stackBoxH} - ${TRUMP_OVERHANG})` : '0px';
  // Suit-glyph badge sits roughly mid-protrusion when the stack still exists.
  const glyphTop =
    visible > 0
      ? `calc(${stackBoxH} - ${TRUMP_OVERHANG} / 2)`
      : '0px';

  const ariaLabel = isEmpty
    ? t('game.deck.empty')
    : t('game.deck.count', { count: deckSize });

  return (
    <div
      className={clsx(
        'flex flex-col items-center gap-1 select-none',
        RESPONSIVE_VARS,
        className,
      )}
      data-testid="deck-stack"
      data-variant={variant}
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
              top: trumpTop,
              width: rotatedW,
              height: rotatedH,
            }}
            data-testid="deck-trump-card"
          >
            {/* Inner div is the un-rotated card; we rotate it 90deg around its
                centre. Width/height here are the card's natural (pre-rotation)
                dimensions — PlayingCard's responsive `md` classes draw the
                actual face. */}
            <div
              className="origin-center"
              style={{
                transform: 'rotate(90deg)',
                width: CW,
                height: CH,
                position: 'absolute',
                left: `calc((${rotatedW} - ${CW}) / 2)`,
                top: `calc((${rotatedH} - ${CH}) / 2)`,
              }}
            >
              <PlayingCard card={trumpCard} size="md" />
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
              top: glyphTop,
              width: 28,
              height: 28,
            }}
            data-testid="deck-trump-glyph"
            aria-label={t('game.info.trumpLabel')}
          >
            {SUIT_GLYPH[trumpSuit]}
          </div>
        ) : null}

        {/* Face-down stack — staggered by --deck-step so depth is visible.
            Rendered after the trump so it draws on top. Each back is wrapped
            in a fixed-size box and CardBackDisplay is forced to fill it
            (`!w-full !h-full`) so the sizing matches the player-hand card
            on every breakpoint, regardless of CardBackDisplay's own size prop. */}
        <div
          className="absolute left-1/2 top-0 -translate-x-1/2 transition-[height] duration-300"
          style={{ width: stackBoxW, height: stackBoxH }}
          data-testid="deck-stack-cards"
        >
          {Array.from({ length: visible }).map((_, i) => (
            <div
              key={i}
              className="absolute"
              style={{
                left: `calc(${STEP} * ${i})`,
                top: `calc(${STEP} * ${i})`,
                width: CW,
                height: CH,
              }}
            >
              <CardBackDisplay
                cardBackId={DECK_CARD_BACK_ID}
                customCardBackUrl={null}
                size="md"
                className="!h-full !w-full"
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
