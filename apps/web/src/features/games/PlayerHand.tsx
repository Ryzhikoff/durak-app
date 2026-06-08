import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { PlayingCard } from './PlayingCard';
import { sortHand } from './handSort';
import { useAuthStore } from '@/stores/auth.store';
import type { Card, Suit } from './types';

export const HAND_CARD_DRAG_ID_PREFIX = 'hand-card:';

interface PlayerHandProps {
  hand: Card[];
  /** Trump suit determines the strong-bucket boundary in the chosen sorter. */
  trumpSuit: Suit | null;
  /**
   * The card currently being dragged, if any. Used to render the source card
   * as a faded ghost — the floating overlay shows the real card under the
   * pointer.
   */
  draggingCardId: string | null;
}

/**
 * Per-breakpoint card width (px) — must mirror `PlayingCard` size="md":
 * `w-14 h-20 xl:w-24 xl:h-36 2xl:w-28 2xl:h-40`. Used to compute how much
 * neighbour-overlap we need so the whole hand fits on the viewport without a
 * horizontal scrollbar.
 */
const CARD_W_BASE = 56; // w-14
const CARD_W_XL = 96; // w-24
const CARD_W_2XL = 112; // w-28
/** Minimum visible slice of an overlapped card — keep at least the corner badge readable. */
const MIN_VISIBLE_BASE = 24;
const MIN_VISIBLE_DESKTOP = 28;
/** Lower bound on overlap so a small hand (<= 4 cards) still looks like a hand. */
const MIN_OVERLAP_BASE = 12; // matches the legacy -ml-3
const MIN_OVERLAP_DESKTOP = 24; // matches the legacy xl:-ml-6
/** Side gutter we leave inside the container so cards don't kiss the screen edge. */
const SIDE_GUTTER = 12;

interface HandMetrics {
  cardW: number;
  minOverlap: number;
  minVisible: number;
}

function pickMetrics(viewportW: number): HandMetrics {
  // Tailwind defaults: md=768, xl=1280, 2xl=1536.
  if (viewportW >= 1536) {
    return { cardW: CARD_W_2XL, minOverlap: MIN_OVERLAP_DESKTOP, minVisible: MIN_VISIBLE_DESKTOP };
  }
  if (viewportW >= 1280) {
    return { cardW: CARD_W_XL, minOverlap: MIN_OVERLAP_DESKTOP, minVisible: MIN_VISIBLE_DESKTOP };
  }
  return { cardW: CARD_W_BASE, minOverlap: MIN_OVERLAP_BASE, minVisible: MIN_VISIBLE_BASE };
}

/**
 * Given the available container width and a hand size, return the px overlap
 * to apply between neighbours so the whole hand fits without horizontal scroll.
 *
 *   N cards + (N-1) overlaps must satisfy:
 *     N*cardW - (N-1)*overlap <= availableW
 *
 *   ⇒ overlap >= (N*cardW - availableW) / (N-1)
 *
 * We clamp the result to `[minOverlap, cardW - minVisible]` so:
 *   - small hands keep their original "loose" look;
 *   - large hands still expose at least the corner rank badge of each card.
 */
function computeOverlap(
  cardCount: number,
  availableW: number,
  m: HandMetrics,
): number {
  if (cardCount <= 1) return m.minOverlap;
  const required = (cardCount * m.cardW - availableW) / (cardCount - 1);
  const maxOverlap = Math.max(0, m.cardW - m.minVisible);
  if (required < m.minOverlap) return m.minOverlap;
  if (required > maxOverlap) return maxOverlap;
  return required;
}

/**
 * Bottom-of-screen hand. Cards are draggable via `@dnd-kit`; drop targets are
 * defined elsewhere (`GameTable` and per-attack entries). No visual gating —
 * every card looks the same, and the server decides legality.
 *
 * Layout: the hand always fits the container width without a horizontal scroll.
 * Overlap between neighbouring cards is recomputed whenever the hand size or
 * the viewport changes (via `ResizeObserver` on the container). Hovered/active
 * cards translate up and bump their z-index so the lifted card is always fully
 * visible regardless of how aggressively the rest of the hand is packed.
 */
export function PlayerHand({ hand, trumpSuit, draggingCardId }: PlayerHandProps) {
  // Pull the viewer's sort preference from the auth store. Falls back to
  // 'power' (the legacy mode) when the user record is missing — keeps
  // anonymous-rendering paths (storybook, tests) deterministic.
  const handSortMode = useAuthStore((s) => s.user?.handSortMode);
  const sortedHand = useMemo(
    () => sortHand(hand, trumpSuit, handSortMode),
    [hand, trumpSuit, handSortMode],
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  // SSR-safe initial viewport: fall back to 0 so first render uses minOverlap.
  // The post-mount ResizeObserver kicks in immediately and recomputes.
  const [containerW, setContainerW] = useState<number>(() =>
    typeof window === 'undefined' ? 0 : window.innerWidth,
  );
  const [viewportW, setViewportW] = useState<number>(() =>
    typeof window === 'undefined' ? 0 : window.innerWidth,
  );

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerW(entry.contentRect.width);
      }
    });
    ro.observe(node);
    // Track viewport width separately to pick the right breakpoint metrics
    // (cardW grows on xl/2xl). The container width alone doesn't tell us
    // whether we're on mobile or desktop.
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const metrics = useMemo(() => pickMetrics(viewportW), [viewportW]);
  const overlap = useMemo(() => {
    const available = Math.max(0, containerW - SIDE_GUTTER * 2);
    return computeOverlap(sortedHand.length, available, metrics);
  }, [sortedHand.length, containerW, metrics]);

  return (
    <div
      ref={containerRef}
      className={clsx(
        // Overflow-hidden (not auto) — by construction the cards already fit
        // via computed overlap, so any tiny rounding spill should be clipped
        // rather than spawn a scrollbar.
        'flex w-full items-end justify-center pb-1 pt-3 xl:pt-4 overflow-hidden',
      )}
      data-testid="player-hand"
      data-overlap={Math.round(overlap)}
      data-card-count={sortedHand.length}
    >
      {sortedHand.length === 0 ? (
        <div className="py-4 text-xs text-textMuted">—</div>
      ) : null}
      {sortedHand.map((card, i) => (
        <DraggableHandCard
          key={card.id}
          card={card}
          dimmed={draggingCardId === card.id}
          // First card sits flush; every subsequent card slides over its
          // left neighbour by `overlap` px. We apply z-index increasing
          // left-to-right so the rightmost card is on top by default — this
          // matches how a real hand fan reads (newest card draws over).
          style={{
            marginLeft: i === 0 ? 0 : -overlap,
            zIndex: i + 1,
          }}
        />
      ))}
    </div>
  );
}

interface DraggableHandCardProps {
  card: Card;
  dimmed: boolean;
  style?: React.CSSProperties;
}

function DraggableHandCard({ card, dimmed, style: outerStyle }: DraggableHandCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `${HAND_CARD_DRAG_ID_PREFIX}${card.id}`,
      data: { kind: 'hand-card', cardId: card.id },
    });

  // While dragging we let the DragOverlay show the moving copy; we only need
  // the in-hand source to fade so the user can see WHICH card was lifted. We
  // intentionally don't apply `transform` to the source slot so the surrounding
  // hand layout stays put.
  const style: React.CSSProperties =
    isDragging || dimmed
      ? { ...outerStyle, touchAction: 'none' }
      : {
          ...outerStyle,
          transform: CSS.Translate.toString(transform),
          touchAction: 'none',
        };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={clsx(
        // `relative` so z-index from the inline style applies. Hover/active
        // bumps z-index to a high constant so the lifted card always paints
        // above its neighbours even when overlap is heavy. The vertical lift
        // (`-translate-y-*`) keeps the card fully visible regardless of how
        // many siblings are stacked over its body.
        'relative cursor-grab transition-transform duration-200 ease-out',
        'hover:-translate-y-3 hover:!z-50 active:cursor-grabbing',
        'xl:hover:-translate-y-4',
      )}
      data-testid={`hand-card-${card.id}`}
    >
      {/* `md` baseline; SIZE_CLASS adds an xl: bump for the desktop layout. */}
      <PlayingCard card={card} size="md" dimmed={isDragging || dimmed} />
    </div>
  );
}
