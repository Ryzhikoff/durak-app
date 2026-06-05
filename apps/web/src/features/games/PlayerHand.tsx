import { useMemo } from 'react';
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
 * Bottom-of-screen hand. Cards are draggable via `@dnd-kit`; drop targets are
 * defined elsewhere (`GameTable` and per-attack entries). No visual gating —
 * every card looks the same, and the server decides legality.
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
  return (
    <div
      className={clsx(
        'flex w-full items-end justify-center gap-1 overflow-x-auto pb-1 pt-3 xl:pt-4',
      )}
      data-testid="player-hand"
    >
      {sortedHand.length === 0 ? (
        <div className="py-4 text-xs text-textMuted">—</div>
      ) : null}
      {sortedHand.map((card, i) => (
        <DraggableHandCard
          key={card.id}
          card={card}
          dimmed={draggingCardId === card.id}
          // Slight overlap so a 6-card hand still fits on a phone screen.
          // Wider overlap on xl to keep the bigger lg cards centred.
          className={clsx(i > 0 ? '-ml-3 xl:-ml-6' : '')}
        />
      ))}
    </div>
  );
}

interface DraggableHandCardProps {
  card: Card;
  dimmed: boolean;
  className?: string;
}

function DraggableHandCard({ card, dimmed, className }: DraggableHandCardProps) {
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
      ? { touchAction: 'none' }
      : { transform: CSS.Translate.toString(transform), touchAction: 'none' };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={clsx(
        'cursor-grab transition-transform duration-200 ease-out hover:-translate-y-1 active:cursor-grabbing xl:hover:-translate-y-2',
        className,
      )}
      data-testid={`hand-card-${card.id}`}
    >
      {/* `md` baseline; SIZE_CLASS adds an xl: bump for the desktop layout. */}
      <PlayingCard card={card} size="md" dimmed={isDragging || dimmed} />
    </div>
  );
}
