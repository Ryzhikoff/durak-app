import clsx from 'clsx';
import { PlayingCard } from './PlayingCard';
import type { AttackEntry } from '@durak/game-engine';

interface GameTableProps {
  attacks: AttackEntry[];
  /** When the local viewer is the defender of an unbeaten attack, they can
   *  click an entry to "target" it before picking a card to beat with. */
  selectedAttackId: string | null;
  onSelectAttack: (id: string) => void;
  /** Defender-only interactivity. Non-defenders see the table read-only. */
  defenderInteractive: boolean;
}

/**
 * Center of the screen: the "стол" with attack/defense pairs. Each unbeaten
 * attack is rendered as a single card; once beaten it shows the attack card
 * with the defense card overlapping at a slight offset.
 */
export function GameTable({
  attacks,
  selectedAttackId,
  onSelectAttack,
  defenderInteractive,
}: GameTableProps) {
  return (
    <div
      className={clsx(
        'relative flex min-h-[160px] w-full flex-wrap items-center justify-center gap-3 rounded-2xl border border-border bg-surface/60 p-3 sm:min-h-[200px]',
      )}
      data-testid="game-table"
    >
      {attacks.length === 0 ? (
        <div className="text-xs text-textMuted">—</div>
      ) : null}
      {attacks.map((entry) => {
        const isUnbeaten = entry.beatenBy === null;
        const isSelected = entry.id === selectedAttackId;
        const interactive = defenderInteractive && isUnbeaten;
        return (
          <AttackEntryView
            key={entry.id}
            entry={entry}
            selected={isSelected}
            interactive={interactive}
            onClick={interactive ? () => onSelectAttack(entry.id) : undefined}
          />
        );
      })}
    </div>
  );
}

function AttackEntryView({
  entry,
  selected,
  interactive,
  onClick,
}: {
  entry: AttackEntry;
  selected: boolean;
  interactive: boolean;
  onClick?: () => void;
}) {
  const wrap = clsx(
    'relative h-24 w-16 sm:h-28 sm:w-20',
    selected ? 'drop-shadow-[0_0_6px_rgba(96,165,250,0.8)]' : '',
  );
  const inner = (
    <>
      <PlayingCard
        card={entry.card}
        size="md"
        className="absolute left-0 top-0"
        selected={selected && entry.beatenBy === null}
      />
      {entry.beatenBy ? (
        <PlayingCard
          card={entry.beatenBy}
          size="md"
          className="absolute left-3 top-3"
        />
      ) : null}
    </>
  );
  if (interactive && onClick) {
    return (
      <button
        type="button"
        className={clsx(wrap, 'cursor-pointer')}
        onClick={onClick}
        aria-label={`select attack ${entry.id}`}
      >
        {inner}
      </button>
    );
  }
  return <div className={wrap}>{inner}</div>;
}
