import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { useLayoutEffect, useRef } from 'react';
import {
  diffNewThrows,
  getPlayerSeatRect,
  useCardThrowAnimation,
} from './useCardThrowAnimation';
import type { AttackEntry, Card } from './types';

/** Tiny helper — every test fixture entry shares the same defender. */
const DEFENDER_ID = 'u-defender';

function mkCard(id: string, suit: 'spades' | 'hearts' = 'spades', rank = 6): Card {
  return { kind: 'standard', id, suit, rank } as Card;
}

function mkEntry(
  id: string,
  attackerId: string,
  beatenBy: Card | null = null,
): AttackEntry {
  return {
    id,
    card: mkCard(`${id}-card`),
    beatenBy,
    attackerId,
  } as AttackEntry;
}

describe('diffNewThrows', () => {
  it('returns each unseen attack entry as a throw', () => {
    const attacks: AttackEntry[] = [
      mkEntry('e1', 'u-a'),
      mkEntry('e2', 'u-b'),
    ];
    const { throws, newTokens } = diffNewThrows(attacks, DEFENDER_ID, new Set());
    expect(throws).toEqual([
      { entryId: 'e1', kind: 'attack', thrownByUserId: 'u-a' },
      { entryId: 'e2', kind: 'attack', thrownByUserId: 'u-b' },
    ]);
    expect(newTokens).toEqual(['attack:e1', 'attack:e2']);
  });

  it('emits a beat throw the first time `beatenBy` flips non-null', () => {
    const attacks: AttackEntry[] = [
      mkEntry('e1', 'u-a', mkCard('e1-def', 'hearts', 7)),
    ];
    const seen = new Set(['attack:e1']);
    const { throws, newTokens } = diffNewThrows(attacks, DEFENDER_ID, seen);
    expect(throws).toEqual([
      { entryId: 'e1', kind: 'beat', thrownByUserId: DEFENDER_ID },
    ]);
    expect(newTokens).toEqual(['beat:e1']);
  });

  it('does not re-emit tokens already in seen-set', () => {
    const attacks: AttackEntry[] = [
      mkEntry('e1', 'u-a', mkCard('e1-def', 'hearts', 7)),
    ];
    const seen = new Set(['attack:e1', 'beat:e1']);
    const { throws } = diffNewThrows(attacks, DEFENDER_ID, seen);
    expect(throws).toEqual([]);
  });

  it('handles empty attacks array', () => {
    expect(diffNewThrows([], DEFENDER_ID, new Set())).toEqual({
      throws: [],
      newTokens: [],
    });
  });
});

describe('getPlayerSeatRect', () => {
  it('returns the rect of an element with matching data-player-id', () => {
    const { container } = render(
      <div data-player-id="u-1" style={{ width: 100, height: 50 }} />,
    );
    // jsdom doesn't actually lay things out, so all rects are (0,0,0,0). The
    // helper falls back to the first match even on zero-sized rects, which
    // is what we get here.
    const rect = getPlayerSeatRect('u-1');
    expect(rect).not.toBeNull();
    // Sanity: querying a non-existent id returns null.
    expect(getPlayerSeatRect('u-missing')).toBeNull();
    // Clean up isn't required (RTL auto-unmounts) but the container ref keeps
    // TS happy.
    expect(container).toBeTruthy();
  });

  it('returns null for empty userId', () => {
    expect(getPlayerSeatRect('')).toBeNull();
  });

  it('escapes user ids that contain CSS selector special chars', () => {
    render(<div data-player-id="user.with.dots" />);
    // Without escaping, `.with` and `.dots` would be parsed as class selectors
    // and the query would miss the element. The helper uses CSS.escape so it
    // still finds the node.
    expect(getPlayerSeatRect('user.with.dots')).not.toBeNull();
  });
});

describe('useCardThrowAnimation', () => {
  /**
   * Tiny harness: renders a div for each attack entry, registers it with the
   * hook in a layout effect, and exposes the hook's calls via a spy on
   * `findSeatRect`. We use `findSeatRect` as the observable — when a new
   * throw fires, the hook calls it to look up the source seat.
   */
  function Harness({
    attacks,
    defenderId,
    findSeatRect,
  }: {
    attacks: AttackEntry[];
    defenderId: string;
    findSeatRect: (id: string) => DOMRect | null;
  }) {
    const api = useCardThrowAnimation(attacks, defenderId, { findSeatRect });
    return (
      <div>
        {attacks.map((e) => (
          <Slot
            key={e.id}
            entryId={e.id}
            attackerId={e.attackerId}
            beatenBy={e.beatenBy}
            defenderId={defenderId}
            register={api.registerSlot}
          />
        ))}
      </div>
    );
  }

  function Slot({
    entryId,
    attackerId,
    beatenBy,
    defenderId,
    register,
  }: {
    entryId: string;
    attackerId: string;
    beatenBy: Card | null;
    defenderId: string;
    register: ReturnType<typeof useCardThrowAnimation>['registerSlot'];
  }) {
    const attackRef = useRef<HTMLDivElement | null>(null);
    const beatRef = useRef<HTMLDivElement | null>(null);
    useLayoutEffect(() => {
      register({
        entryId,
        kind: 'attack',
        thrownByUserId: attackerId,
        el: attackRef.current,
      });
    }, [entryId, attackerId, register]);
    useLayoutEffect(() => {
      if (beatenBy === null) return;
      register({
        entryId,
        kind: 'beat',
        thrownByUserId: defenderId,
        el: beatRef.current,
      });
    }, [entryId, beatenBy, defenderId, register]);
    return (
      <div>
        <div ref={attackRef} data-testid={`attack-${entryId}`} />
        {beatenBy !== null ? (
          <div ref={beatRef} data-testid={`beat-${entryId}`} />
        ) : null}
      </div>
    );
  }

  it('does NOT call findSeatRect for the initial table snapshot', () => {
    const seatLookups: string[] = [];
    const findSeatRect = (id: string) => {
      seatLookups.push(id);
      return null;
    };
    render(
      <Harness
        attacks={[mkEntry('e1', 'u-a'), mkEntry('e2', 'u-b')]}
        defenderId={DEFENDER_ID}
        findSeatRect={findSeatRect}
      />,
    );
    // Initial render seeds the seen-set — none of the slots should trigger
    // a seat lookup.
    expect(seatLookups).toEqual([]);
  });

  it('calls findSeatRect for newly-added attacks', () => {
    const seatLookups: string[] = [];
    const findSeatRect = (id: string) => {
      seatLookups.push(id);
      return null;
    };
    const { rerender } = render(
      <Harness
        attacks={[mkEntry('e1', 'u-a')]}
        defenderId={DEFENDER_ID}
        findSeatRect={findSeatRect}
      />,
    );
    // Add a second attack — the hook should detect the diff and register
    // a pending throw for it; when the new slot mounts and calls
    // registerSlot, findSeatRect runs.
    act(() => {
      rerender(
        <Harness
          attacks={[mkEntry('e1', 'u-a'), mkEntry('e2', 'u-b')]}
          defenderId={DEFENDER_ID}
          findSeatRect={findSeatRect}
        />,
      );
    });
    expect(seatLookups).toEqual(['u-b']);
  });

  it('attributes beat throws to the current defender', () => {
    const seatLookups: string[] = [];
    const findSeatRect = (id: string) => {
      seatLookups.push(id);
      return null;
    };
    const { rerender } = render(
      <Harness
        attacks={[mkEntry('e1', 'u-a')]}
        defenderId="u-def-1"
        findSeatRect={findSeatRect}
      />,
    );
    act(() => {
      rerender(
        <Harness
          attacks={[mkEntry('e1', 'u-a', mkCard('e1-def', 'hearts', 7))]}
          defenderId="u-def-1"
          findSeatRect={findSeatRect}
        />,
      );
    });
    expect(seatLookups).toEqual(['u-def-1']);
  });

  it('does not re-animate the same card on subsequent re-renders', () => {
    const seatLookups: string[] = [];
    const findSeatRect = (id: string) => {
      seatLookups.push(id);
      return null;
    };
    const { rerender } = render(
      <Harness
        attacks={[mkEntry('e1', 'u-a')]}
        defenderId={DEFENDER_ID}
        findSeatRect={findSeatRect}
      />,
    );
    // Add a new entry — animates once.
    act(() => {
      rerender(
        <Harness
          attacks={[mkEntry('e1', 'u-a'), mkEntry('e2', 'u-b')]}
          defenderId={DEFENDER_ID}
          findSeatRect={findSeatRect}
        />,
      );
    });
    // Re-render with same attacks — should NOT trigger a new lookup.
    act(() => {
      rerender(
        <Harness
          attacks={[mkEntry('e1', 'u-a'), mkEntry('e2', 'u-b')]}
          defenderId={DEFENDER_ID}
          findSeatRect={findSeatRect}
        />,
      );
    });
    expect(seatLookups).toEqual(['u-b']);
  });
});
