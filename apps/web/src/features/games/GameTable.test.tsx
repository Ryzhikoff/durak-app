import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import '@/lib/i18n';
import { GameTable } from './GameTable';
import type { AttackEntry, Card } from './types';

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (state: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: 'u-me' } }),
}));

function card(id: string, suit: 'spades' | 'hearts' = 'spades', rank = 6): Card {
  return { kind: 'standard', id, suit, rank } as Card;
}

function renderWithDnd(children: React.ReactNode) {
  return render(<DndContext>{children}</DndContext>);
}

describe('GameTable smoke', () => {
  it('renders the empty-state placeholder when no attacks', () => {
    renderWithDnd(
      <GameTable
        attacks={[]}
        currentDefenderId="u-def"
        centerActive={false}
        highlightedAttackIds={new Set()}
        droppableAttackIds={new Set()}
      />,
    );
    expect(screen.getByTestId('game-table')).toBeInTheDocument();
  });

  it('renders each attack entry with its attack and (optional) beat slots', () => {
    const attacks: AttackEntry[] = [
      { id: 'e1', card: card('a1'), beatenBy: null, attackerId: 'u-att' } as AttackEntry,
      {
        id: 'e2',
        card: card('a2'),
        beatenBy: card('d2', 'hearts', 7),
        attackerId: 'u-att',
      } as AttackEntry,
    ];
    renderWithDnd(
      <GameTable
        attacks={attacks}
        currentDefenderId="u-def"
        centerActive={false}
        highlightedAttackIds={new Set()}
        droppableAttackIds={new Set()}
      />,
    );
    expect(screen.getByTestId('attack-e1')).toBeInTheDocument();
    expect(screen.getByTestId('attack-e2')).toBeInTheDocument();
    expect(screen.getByTestId('attack-e2-beaten')).toBeInTheDocument();
  });
});
