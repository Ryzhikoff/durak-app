import { useLayoutEffect, useRef } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { Flag } from 'lucide-react';
import { PlayingCard } from './PlayingCard';
import type { AttackEntry } from '@durak/game-engine';
import {
  useCardThrowAnimation,
  type CardThrowAnimationApi,
} from './useCardThrowAnimation';

export const TABLE_DROP_ID = 'game-table';
export const ATTACK_DROP_ID_PREFIX = 'attack:';

export const attackDropId = (attackId: string): string =>
  `${ATTACK_DROP_ID_PREFIX}${attackId}`;

interface GameTableProps {
  attacks: AttackEntry[];
  /**
   * Engine id of the current defender — used to attribute "beat" animations
   * to the right seat (the engine doesn't persist `defenderId` on
   * `AttackEntry.beatenBy`, but the role doesn't rotate mid-bout so the
   * snapshot's `currentDefenderId` is the right source).
   */
  currentDefenderId: string;
  /** Whether the table itself accepts drops right now (centre zone). */
  centerActive: boolean;
  /**
   * Set of unbeaten attack entry ids that should highlight as legal beat
   * targets. Empty set ⇒ no per-attack zone glows. When cheating is on the
   * parent passes every unbeaten attack id here.
   */
  highlightedAttackIds: ReadonlySet<string>;
  /**
   * Set of unbeaten attack entry ids that should accept drops at all (legal
   * OR illegal). Illegal-but-droppable entries catch the drop so it isn't
   * forwarded to the centre zone, where it would be misinterpreted as a fresh
   * attack/translate and rejected by the engine with a confusing error.
   * Beaten entries never appear in this set — drops on them fall through to
   * the centre.
   */
  droppableAttackIds: ReadonlySet<string>;
  /**
   * Per-entry sets describing which cards on the table the viewer is allowed
   * to flag as a cheat. We expose two sets so the icon can appear on either
   * the attack card (unbeaten entry) or the defense card (beat-cheat). Empty
   * sets (or `undefined`) hide the icons entirely. Provided by the parent —
   * see `GamePage.canPlayerNoticeEntry`.
   */
  noticeableAttackIds?: ReadonlySet<string>;
  noticeableBeatIds?: ReadonlySet<string>;
  /** Click handler invoked when the viewer taps the cheat icon on an entry. */
  onNoticeCheat?: (attackEntryId: string) => void;
}

/**
 * Centre of the screen: a single large drop zone that accepts attack/throw-in/
 * translate plays, plus a per-unbeaten-attack drop zone for direct "beat" moves.
 * All click/tap interactivity is gone — defenders now drag a card directly
 * onto the entry they want to beat.
 */
export function GameTable({
  attacks,
  currentDefenderId,
  centerActive,
  highlightedAttackIds,
  droppableAttackIds,
  noticeableAttackIds,
  noticeableBeatIds,
  onNoticeCheat,
}: GameTableProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: TABLE_DROP_ID,
    data: { kind: 'table-center' },
    disabled: !centerActive,
  });

  // Throw-the-card animation API. Each AttackEntryView registers its attack
  // card slot (and, when present, its beat overlay) so the hook can fly the
  // freshly-mounted card from the throwing player's seat to the slot.
  const throwAnim = useCardThrowAnimation(attacks, currentDefenderId);

  return (
    <div
      ref={setNodeRef}
      className={clsx(
        'felt-table relative flex min-h-[180px] w-full flex-wrap items-center justify-center gap-3 rounded-3xl border-2 p-4 sm:min-h-[220px] xl:min-h-[360px] xl:gap-5 xl:p-8',
        'bg-emerald-950 transition-colors',
        centerActive
          ? isOver
            ? 'border-accent ring-2 ring-accent/70'
            : 'border-accent/50'
          : 'border-emerald-900/80',
      )}
      data-testid="game-table"
    >
      {attacks.length === 0 ? (
        <div className="text-xs text-emerald-200/40">—</div>
      ) : null}
      {attacks.map((entry) => {
        const isUnbeaten = entry.beatenBy === null;
        const isHighlighted = isUnbeaten && highlightedAttackIds.has(entry.id);
        const isDroppable = isUnbeaten && droppableAttackIds.has(entry.id);
        const canNoticeAttack =
          isUnbeaten && !!noticeableAttackIds?.has(entry.id);
        const canNoticeBeat =
          !isUnbeaten && !!noticeableBeatIds?.has(entry.id);
        return (
          <AttackEntryView
            key={entry.id}
            entry={entry}
            currentDefenderId={currentDefenderId}
            highlighted={isHighlighted}
            droppable={isDroppable}
            canNoticeAttack={canNoticeAttack}
            canNoticeBeat={canNoticeBeat}
            onNoticeCheat={onNoticeCheat}
            throwAnim={throwAnim}
          />
        );
      })}
    </div>
  );
}

interface AttackEntryViewProps {
  entry: AttackEntry;
  /** Snapshot's current defender — see GameTableProps for rationale. */
  currentDefenderId: string;
  highlighted: boolean;
  droppable: boolean;
  canNoticeAttack: boolean;
  canNoticeBeat: boolean;
  onNoticeCheat?: (attackEntryId: string) => void;
  throwAnim: CardThrowAnimationApi;
}

function AttackEntryView({
  entry,
  currentDefenderId,
  highlighted,
  droppable,
  canNoticeAttack,
  canNoticeBeat,
  onNoticeCheat,
  throwAnim,
}: AttackEntryViewProps) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({
    id: attackDropId(entry.id),
    data: { kind: 'attack-entry', attackEntryId: entry.id },
    disabled: !droppable,
  });
  // Refs to the actual card wrappers — these are the elements we translate
  // back to the seat for the FLIP-style throw. Layout effect so the
  // transform lands BEFORE the browser paints the freshly-mounted card.
  const attackCardRef = useRef<HTMLDivElement | null>(null);
  const beatCardRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    throwAnim.registerSlot({
      entryId: entry.id,
      kind: 'attack',
      thrownByUserId: entry.attackerId,
      el: attackCardRef.current,
    });
  }, [entry.id, entry.attackerId, throwAnim]);
  useLayoutEffect(() => {
    if (entry.beatenBy === null) return;
    throwAnim.registerSlot({
      entryId: entry.id,
      kind: 'beat',
      thrownByUserId: currentDefenderId,
      el: beatCardRef.current,
    });
  }, [entry.id, entry.beatenBy, currentDefenderId, throwAnim]);

  const isBeaten = entry.beatenBy !== null;
  // Wrap sized to the card itself (md = 56x80, sm md = 64x96, xl md = 80x112).
  // Drop area is the card outline; overflow stays visible so the rotated
  // defense card on top can poke a few pixels outside without being clipped.
  const wrap = clsx(
    'relative rounded-lg transition-shadow overflow-visible',
    'h-20 w-14 sm:h-24 sm:w-16 xl:h-36 xl:w-24 2xl:h-40 2xl:w-28',
    highlighted
      ? isOver
        ? 'ring-4 ring-accent drop-shadow-[0_0_8px_rgba(96,165,250,0.95)]'
        : 'ring-2 ring-accent/70 drop-shadow-[0_0_6px_rgba(96,165,250,0.55)]'
      : '',
  );

  return (
    <div ref={setNodeRef} className={wrap} data-testid={`attack-${entry.id}`}>
      {/* Attack card sits in the wrap. Ref lets the throw-animation hook
          translate it back to the attacker's seat on mount. */}
      <div ref={attackCardRef} className="absolute inset-0">
        <PlayingCard
          card={entry.card}
          size="md"
          className={clsx('shadow-xl', isBeaten ? 'opacity-90' : '')}
        />
      </div>
      {canNoticeAttack && onNoticeCheat ? (
        <NoticeCheatButton
          entryId={entry.id}
          onNoticeCheat={onNoticeCheat}
          ariaLabel={t('game.cheat.noticeAria')}
          /* Target the attack card — top-right corner of the entry. */
          position="attack"
          testId={`notice-cheat-attack-${entry.id}`}
        />
      ) : null}
      {entry.beatenBy ? (
        /* Defense card lies ON TOP of the attack, offset down-right and
         * tilted enough that the underlying attack card's top-left corner
         * (its rank + suit) stays clearly visible. 8° was too subtle —
         * the suit on the bottom card disappeared under the overlay. */
        <div
          ref={beatCardRef}
          className="absolute left-[14px] top-[2px] z-10"
          data-testid={`attack-${entry.id}-beaten`}
        >
          {/* Inner wrapper carries the visual 16° tilt so the outer div is
           * free for the FLIP throw-animation to write its own translate
           * transform without colliding. */}
          <div className="relative rotate-[16deg] origin-center">
            <PlayingCard card={entry.beatenBy} size="md" className="shadow-xl" />
            {canNoticeBeat && onNoticeCheat ? (
              <NoticeCheatButton
                entryId={entry.id}
                onNoticeCheat={onNoticeCheat}
                ariaLabel={t('game.cheat.noticeAria')}
                /* Target the defense card — top-right of the rotated overlay. */
                position="beat"
                testId={`notice-cheat-beat-${entry.id}`}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface NoticeCheatButtonProps {
  entryId: string;
  onNoticeCheat: (attackEntryId: string) => void;
  ariaLabel: string;
  position: 'attack' | 'beat';
  testId: string;
}

/**
 * Clickable flag centred on the card being flagged. For 'attack' the parent
 * is the entry wrap so it sits centred on the attack; for 'beat' the parent
 * is the rotated defense overlay so it inherits the tilt and ends up centred
 * on the defense card. Stops drag propagation so DnD doesn't fight the tap.
 */
function NoticeCheatButton({
  entryId,
  onNoticeCheat,
  ariaLabel,
  position: _position,
  testId,
}: NoticeCheatButtonProps) {
  const className = clsx(
    'absolute z-20 inline-flex h-7 w-7 items-center justify-center rounded-full',
    'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
    'bg-rose-600 text-white shadow-md ring-1 ring-rose-300/60',
    'hover:bg-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300',
  );
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      data-testid={testId}
      className={className}
      onPointerDown={(e) => {
        // Keep DnD sensors from interpreting this as a drag.
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        onNoticeCheat(entryId);
      }}
    >
      <Flag className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}
