import clsx from 'clsx';
import { PlayerChip } from './PlayerChip';
import type { ClientGamePlayer } from './types';

interface RadialOpponentsProps {
  /**
   * Opponents in stable clockwise order from the viewer (the viewer themself
   * is *not* in this list — they sit conceptually at the bottom of the table).
   */
  opponents: ClientGamePlayer[];
  /** Engine ids used to highlight the active seats. */
  currentAttackerId: string;
  currentDefenderId: string;
  /** Whether to render the cheat-attempts badge on each chip. */
  showCheatBadge: boolean;
  /** Floating reaction map (per opponent id). */
  reactions: Record<string, { emoji: string; timestamp: string } | null>;
  /** Floating text-reaction map (per opponent id). Independent of `reactions`. */
  textReactions?: Record<string, { text: string; timestamp: string } | null>;
}

/**
 * Percentage-based positions around the table for each possible opponent
 * count (1..5). Coordinates are `(leftPercent, topPercent)` and apply to the
 * chip's centre — the chip uses translate(-50%, -50%) so it stays centred
 * regardless of its own size.
 *
 * Layout philosophy: the viewer sits at the bottom-centre (under the table);
 * opponents fan out across the upper half of the table area so the felt
 * stays visually open and dramatic. With 4–5 opponents we also use the
 * side positions to avoid stuffing too many chips in the top row.
 *
 * Vertical positions stay at ≥14% so the ~120px PlayerChip (translated -50%
 * on Y) never reaches into the InfoStrip sitting above the arena — combined
 * with the arena's `xl:pt-32` we get a comfortable gap regardless of viewer
 * height.
 */
const POSITIONS: Record<number, Array<[number, number]>> = {
  1: [[50, 16]],
  2: [
    [25, 18],
    [75, 18],
  ],
  3: [
    [20, 26],
    [50, 14],
    [80, 26],
  ],
  4: [
    [10, 40],
    [33, 16],
    [67, 16],
    [90, 40],
  ],
  5: [
    [8, 50],
    [25, 20],
    [50, 14],
    [75, 20],
    [92, 50],
  ],
};

/**
 * Desktop-only radial opponent layout. Renders a transparent absolute overlay
 * that pins each opponent's `PlayerChip` (seat variant) around the felt table.
 * Parent is responsible for being `relative` and sized appropriately — see
 * `GamePage` where this is mounted alongside `GameTable`.
 *
 * Hidden on small screens; the mobile players-row in `GamePage` handles those
 * viewports.
 */
export function RadialOpponents({
  opponents,
  currentAttackerId,
  currentDefenderId,
  showCheatBadge,
  reactions,
  textReactions,
}: RadialOpponentsProps) {
  const count = opponents.length;
  if (count === 0) return null;
  // We cap at 5 (max 6 players → 5 opponents). Anything beyond falls back to
  // the 5-seat layout, which still looks reasonable.
  const positions = POSITIONS[Math.min(count, 5)] ?? POSITIONS[5];

  return (
    <div
      className="pointer-events-none absolute inset-0 hidden xl:block"
      aria-hidden="false"
      data-testid="radial-opponents"
    >
      {opponents.map((opponent, i) => {
        const pos = positions[i] ?? positions[positions.length - 1];
        const [left, top] = pos;
        return (
          <div
            key={opponent.id}
            className={clsx(
              'pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2',
            )}
            style={{ left: `${left}%`, top: `${top}%` }}
          >
            <PlayerChip
              player={opponent}
              isAttacker={opponent.id === currentAttackerId}
              isDefender={opponent.id === currentDefenderId}
              showCheatBadge={showCheatBadge}
              reaction={reactions[opponent.id] ?? null}
              textReaction={textReactions?.[opponent.id] ?? null}
              variant="seat"
            />
          </div>
        );
      })}
    </div>
  );
}
