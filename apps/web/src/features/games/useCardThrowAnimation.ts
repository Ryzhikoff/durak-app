import { useCallback, useEffect, useRef } from 'react';
import type { AttackEntry } from './types';

/**
 * Phase 9 polish — "throw the card" animation.
 *
 * When a new attack card lands on the table OR a defense card lands on top of
 * an attack, we want the card to visually fly from the player's seat
 * (their `PlayerChip` in the radial layout / mobile players row) to the table
 * slot it ends up in. This makes it obvious WHO threw what, especially in
 * 4–6 player matches where the felt fills up quickly.
 *
 * The implementation is a FLIP-like trick using imperative DOM manipulation:
 *  1. After the slot mounts, we measure the slot's `getBoundingClientRect`.
 *  2. We look up the source seat via `[data-player-id="..."]` and measure it.
 *  3. We set `transform: translate(dx, dy) scale(0.6)` on the slot element
 *     synchronously (so the card visually starts at the seat).
 *  4. On the next animation frame we clear the transform and apply a
 *     `transition: transform <duration> cubic-bezier(...)` so the browser
 *     animates the card to its final position.
 *  5. After the animation ends, we strip the inline transition so subsequent
 *     re-renders aren't affected.
 *
 * Cards we've already animated are tracked in a `Set<string>` keyed by a
 * stable per-entry token (`attack:<entryId>` / `beat:<entryId>`) — re-mounts
 * (e.g. table re-renders for unrelated state changes) DO NOT replay the
 * animation. The set is also pre-seeded on first mount so the initial table
 * snapshot (e.g. resuming a paused game with cards already on the felt) does
 * NOT play a flurry of throws.
 *
 * If the source seat element can't be found (player disconnected and their
 * chip is not in the DOM), the animation is silently skipped — the card just
 * appears in place. We don't throw; the rest of the table still renders.
 *
 * NOTE: We don't add framer-motion / react-spring — pure DOM, no deps.
 */

/** Default duration in ms. Tweak via `options.durationMs`. */
const DEFAULT_DURATION_MS = 360;

/** Default easing — feels snappy without being too zippy. */
const DEFAULT_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

export interface CardThrowAnimationOptions {
  durationMs?: number;
  easing?: string;
  /**
   * Override the seat lookup. Mostly for tests. Defaults to a DOM query.
   */
  findSeatRect?: (userId: string) => DOMRect | null;
}

export interface RegisterSlotArgs {
  entryId: string;
  kind: 'attack' | 'beat';
  /** The user id of the player who PLACED this card (attacker for attack;
   *  defender for beat). */
  thrownByUserId: string;
  /** DOM element representing the slot — i.e. the card that should animate. */
  el: HTMLElement | null;
}

/**
 * Default seat resolver: looks up `[data-player-id="<userId>"]` anywhere in
 * the document and returns its bounding rect. In the radial seat layout AND
 * the mobile players row, every `PlayerChip` already carries this attribute,
 * so we don't have to wire refs through three components.
 *
 * Multiple chips with the same data-player-id can exist (mobile row + radial
 * seat are both mounted but one is hidden by Tailwind responsive classes).
 * We pick the FIRST one that has a non-zero bounding rect — hidden chips
 * report `width: 0` / `height: 0` and we want to animate from the visible
 * source seat for the current breakpoint.
 */
export function getPlayerSeatRect(userId: string): DOMRect | null {
  if (typeof document === 'undefined') return null;
  if (!userId) return null;
  const escaped =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(userId)
      : userId.replace(/"/g, '\\"');
  const nodes = document.querySelectorAll<HTMLElement>(
    `[data-player-id="${escaped}"]`,
  );
  for (const node of Array.from(nodes)) {
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return rect;
  }
  // Fall back to the first match's rect even if it's zero-sized — better
  // than null so the consumer can still no-op gracefully.
  if (nodes.length > 0) return nodes[0].getBoundingClientRect();
  return null;
}

interface PendingThrow {
  entryId: string;
  kind: 'attack' | 'beat';
  thrownByUserId: string;
}

/**
 * Compute the set of "throws to animate" given the current attacks array and
 * the previously seen token set. Returns the new tokens too so the caller can
 * union them into the seen set.
 *
 * Exposed for unit-testing the diff logic without touching the DOM.
 */
export function diffNewThrows(
  attacks: AttackEntry[],
  currentDefenderId: string,
  seenTokens: ReadonlySet<string>,
): { throws: PendingThrow[]; newTokens: string[] } {
  const throws: PendingThrow[] = [];
  const newTokens: string[] = [];
  for (const entry of attacks) {
    const attackToken = `attack:${entry.id}`;
    if (!seenTokens.has(attackToken)) {
      throws.push({
        entryId: entry.id,
        kind: 'attack',
        thrownByUserId: entry.attackerId,
      });
      newTokens.push(attackToken);
    }
    if (entry.beatenBy !== null) {
      const beatToken = `beat:${entry.id}`;
      if (!seenTokens.has(beatToken)) {
        throws.push({
          entryId: entry.id,
          kind: 'beat',
          // Engine doesn't persist who beat the entry; the current defender is
          // the one who just placed it, since beat is what they're doing right
          // now and the defender role doesn't rotate until the bout settles.
          thrownByUserId: currentDefenderId,
        });
        newTokens.push(beatToken);
      }
    }
  }
  return { throws, newTokens };
}

export interface CardThrowAnimationApi {
  /** Call from the slot's ref callback / effect. Pass `null` on unmount. */
  registerSlot: (args: RegisterSlotArgs) => void;
}

/**
 * React hook. Tracks the previous attacks state and, when slots register
 * after a re-render that introduced new cards, animates them from the
 * thrower's seat to the slot.
 *
 * Lifecycle contract:
 *  - On every render, if the slot's element is mounted, the consumer calls
 *    `registerSlot` (e.g. in a `useLayoutEffect`).
 *  - Internally we maintain a per-token queue of "pending throws". When a
 *    slot registers AND its token is in the pending queue, we run the
 *    animation immediately and drop the token from the queue.
 *  - Slots whose tokens are already in the seen-set are NOT animated (e.g.
 *    re-renders, snapshot loads).
 */
export function useCardThrowAnimation(
  attacks: AttackEntry[],
  currentDefenderId: string,
  options?: CardThrowAnimationOptions,
): CardThrowAnimationApi {
  const seenTokensRef = useRef<Set<string>>(new Set());
  const pendingThrowsRef = useRef<Map<string, PendingThrow>>(new Map());
  const initializedRef = useRef(false);

  const durationMs = options?.durationMs ?? DEFAULT_DURATION_MS;
  const easing = options?.easing ?? DEFAULT_EASING;
  const findSeatRect = options?.findSeatRect ?? getPlayerSeatRect;

  // First render: seed the seen-set with whatever is already on the table so
  // re-mounts and initial snapshots don't replay every card flying in.
  if (!initializedRef.current) {
    initializedRef.current = true;
    for (const entry of attacks) {
      seenTokensRef.current.add(`attack:${entry.id}`);
      if (entry.beatenBy !== null) {
        seenTokensRef.current.add(`beat:${entry.id}`);
      }
    }
  } else {
    // Subsequent renders — diff against seen-set and queue new throws.
    const { throws } = diffNewThrows(
      attacks,
      currentDefenderId,
      seenTokensRef.current,
    );
    for (const t of throws) {
      const token = `${t.kind}:${t.entryId}`;
      // Don't add to seenTokens YET — that happens when the slot is registered
      // and animation triggers, OR if no slot ever registers (we clean up in
      // the cleanup effect below to avoid leaks).
      pendingThrowsRef.current.set(token, t);
    }
  }

  // Garbage-collect tokens for entries that disappeared from the attacks
  // array (bout ended, table cleared). We never want the seen-set to grow
  // unboundedly across many bouts.
  useEffect(() => {
    const liveTokens = new Set<string>();
    for (const entry of attacks) {
      liveTokens.add(`attack:${entry.id}`);
      if (entry.beatenBy !== null) liveTokens.add(`beat:${entry.id}`);
    }
    // Prune seen tokens that no longer correspond to live attacks.
    for (const token of Array.from(seenTokensRef.current)) {
      if (!liveTokens.has(token)) seenTokensRef.current.delete(token);
    }
    // Prune pending throws whose slot never registered (e.g. card was
    // immediately removed by an undo path). Defensive — shouldn't happen in
    // practice but keeps the map bounded.
    for (const token of Array.from(pendingThrowsRef.current.keys())) {
      if (!liveTokens.has(token)) pendingThrowsRef.current.delete(token);
    }
  }, [attacks]);

  const registerSlot = useCallback(
    ({ entryId, kind, thrownByUserId, el }: RegisterSlotArgs) => {
      if (!el) return;
      const token = `${kind}:${entryId}`;
      const pending = pendingThrowsRef.current.get(token);
      if (!pending) return; // Not a new throw — either already animated or
      // seeded on first mount.
      // Look up source seat. If the chip isn't in the DOM yet (race
      // condition during initial render) OR the player has no chip
      // (disconnected, spectator-only state), skip the animation.
      const sourceRect = findSeatRect(thrownByUserId);
      if (!sourceRect) {
        // Mark as seen so we don't keep re-querying on every render.
        seenTokensRef.current.add(token);
        pendingThrowsRef.current.delete(token);
        return;
      }
      const targetRect = el.getBoundingClientRect();
      if (targetRect.width === 0 || targetRect.height === 0) {
        // Slot hidden (e.g. wrapped inside a `hidden xl:block` parent).
        // Skip gracefully; the card will still appear in place.
        seenTokensRef.current.add(token);
        pendingThrowsRef.current.delete(token);
        return;
      }
      // Compute delta from target's centre to source's centre.
      const dx =
        sourceRect.left + sourceRect.width / 2 -
        (targetRect.left + targetRect.width / 2);
      const dy =
        sourceRect.top + sourceRect.height / 2 -
        (targetRect.top + targetRect.height / 2);

      // Mark the token as handled BEFORE animating so re-entry can't fire it
      // twice (e.g. StrictMode double-invoke).
      seenTokensRef.current.add(token);
      pendingThrowsRef.current.delete(token);

      // FLIP step 1: jump to source position without transition.
      const prevTransition = el.style.transition;
      const prevTransform = el.style.transform;
      const prevWillChange = el.style.willChange;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px) scale(0.6)`;
      el.style.willChange = 'transform';
      // Force a layout flush so the browser applies the transform before we
      // change it back. Reading offsetWidth is the canonical FLIP "force
      // synchronous layout" trick.
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      el.offsetWidth;

      // FLIP step 2: animate back to identity on the next frame.
      const raf = requestAnimationFrame(() => {
        el.style.transition = `transform ${durationMs}ms ${easing}`;
        el.style.transform = '';
      });

      // FLIP step 3: cleanup once the transition finishes.
      const onEnd = (e: TransitionEvent) => {
        if (e.propertyName !== 'transform') return;
        el.style.transition = prevTransition;
        el.style.transform = prevTransform;
        el.style.willChange = prevWillChange;
        el.removeEventListener('transitionend', onEnd);
      };
      el.addEventListener('transitionend', onEnd);

      // Belt-and-braces fallback: if transitionend never fires (element
      // removed mid-flight, browser quirk) we still clear the inline styles
      // after the animation should be done.
      setTimeout(() => {
        // If the element is still around AND still has our transition set,
        // strip it. We don't undo the transform here — by this point the
        // browser has long ago painted it at the target.
        if (el.style.transition.includes(`${durationMs}ms`)) {
          el.style.transition = prevTransition;
          el.style.willChange = prevWillChange;
        }
        cancelAnimationFrame(raf);
      }, durationMs + 100);
    },
    [durationMs, easing, findSeatRect],
  );

  return { registerSlot };
}
