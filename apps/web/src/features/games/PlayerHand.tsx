import { useMemo } from 'react';
import clsx from 'clsx';
import { PlayingCard } from './PlayingCard';
import type { Card, Suit } from './types';

export type HandCardIntent = 'attack' | 'beat' | 'translate' | 'idle';

export interface HandCardState {
  /** What clicking this card would mean right now (drives onTap). */
  intent: HandCardIntent;
  /** Visually faded — cannot be played in the current state. */
  dimmed?: boolean;
}

interface PlayerHandProps {
  hand: Card[];
  /** Current trump suit (used to push trumps to the end). */
  trumpSuit: Suit | null;
  /** Per-card UX state keyed by `card.id`. */
  states: Record<string, HandCardState>;
  /** Invoked with the card and the intent currently associated with it. */
  onCardTap: (card: Card, intent: HandCardIntent) => void;
}

// Standard suit order for non-trump cards: clubs → diamonds → hearts → spades.
const SUIT_ORDER: Record<Suit, number> = {
  clubs: 0,
  diamonds: 1,
  hearts: 2,
  spades: 3,
};

/**
 * Stable sort for the hand:
 *  1. Standard cards grouped by suit (clubs/diamonds/hearts/spades), ranks asc.
 *  2. Trumps after every non-trump suit, ranks asc.
 *  3. Jokers last: red before black.
 *
 * Pure: returns a new array, never mutates the input.
 */
function sortHand(hand: readonly Card[], trumpSuit: Suit | null): Card[] {
  const bucket = (c: Card): number => {
    if (c.kind === 'joker') return 3;
    if (trumpSuit !== null && c.suit === trumpSuit) return 2;
    return 0;
  };
  return [...hand].sort((a, b) => {
    const ba = bucket(a);
    const bb = bucket(b);
    if (ba !== bb) return ba - bb;
    if (a.kind === 'joker' && b.kind === 'joker') {
      // red before black
      return a.color === b.color ? 0 : a.color === 'red' ? -1 : 1;
    }
    if (a.kind === 'standard' && b.kind === 'standard') {
      // Trumps share a bucket so suit comparison is a no-op there; for
      // non-trumps we order by the canonical suit order.
      if (ba === 0) {
        const sa = SUIT_ORDER[a.suit];
        const sb = SUIT_ORDER[b.suit];
        if (sa !== sb) return sa - sb;
      }
      return a.rank - b.rank;
    }
    return 0;
  });
}

/**
 * Bottom-of-screen hand. Cards overlap on small viewports to fit; the row is
 * horizontally scrollable when the overlap stops fitting (very rare — only a
 * defender after a take with a giant hand).
 */
export function PlayerHand({ hand, trumpSuit, states, onCardTap }: PlayerHandProps) {
  const sortedHand = useMemo(() => sortHand(hand, trumpSuit), [hand, trumpSuit]);
  return (
    <div
      className={clsx(
        'flex w-full items-end justify-center gap-1 overflow-x-auto pb-1 pt-3',
      )}
      data-testid="player-hand"
    >
      {sortedHand.length === 0 ? (
        <div className="py-4 text-xs text-textMuted">—</div>
      ) : null}
      {sortedHand.map((card, i) => {
        const s = states[card.id] ?? { intent: 'idle' as const };
        return (
          <PlayingCard
            key={card.id}
            card={card}
            size="md"
            interactive={s.intent !== 'idle'}
            selected={false}
            dimmed={s.dimmed}
            onClick={() => onCardTap(card, s.intent)}
            // Slight overlap so a 6-card hand still fits on a phone screen.
            className={clsx(i > 0 ? '-ml-3' : '')}
          />
        );
      })}
    </div>
  );
}
