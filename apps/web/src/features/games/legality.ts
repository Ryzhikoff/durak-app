/**
 * Pure client-side move-legality helpers.
 *
 * These mirror the server-authoritative engine rules at a coarse level — just
 * enough to stop the UI from firing obviously illegal commands when cheating
 * is disabled. The server is still the source of truth and will reject any
 * mistakes we let slip through.
 *
 * When `cheatingEnabled` is on, the UI bypasses these checks and lets the
 * player attempt anything; the server will accept or surface a cheat notice in
 * Phase 6.
 *
 * All helpers are dependency-free pure functions so they can be unit-tested
 * without dragging React or the engine runtime into the test sandbox.
 */
import type { AttackEntry, Card, ClientGameState, Suit } from './types';

/**
 * Can `defense` legally beat `attack` given the current `trumpSuit`?
 *
 *  - A joker beats a standard card iff the card's suit colour matches the
 *    joker's colour (red joker → hearts/diamonds; black joker → spades/clubs).
 *    Trump suit does NOT affect jokers.
 *  - A joker never beats another joker.
 *  - A standard card can never beat a joker on the table.
 *  - Trump beats non-trump.
 *  - Same-suit higher rank beats lower rank.
 */
export function canBeatCard(
  defense: Card,
  attack: Card,
  trumpSuit: Suit | null,
): boolean {
  if (defense.kind === 'joker') {
    if (attack.kind === 'joker') return false;
    const attackColor: 'red' | 'black' =
      attack.suit === 'hearts' || attack.suit === 'diamonds' ? 'red' : 'black';
    return defense.color === attackColor;
  }
  if (attack.kind === 'joker') return false;
  const defIsTrump = trumpSuit != null && defense.suit === trumpSuit;
  const atkIsTrump = trumpSuit != null && attack.suit === trumpSuit;
  if (defIsTrump && !atkIsTrump) return true;
  if (!defIsTrump && atkIsTrump) return false;
  return defense.suit === attack.suit && defense.rank > attack.rank;
}

/**
 * Can the player legally attack/throw-in `card` given the current table?
 *
 *  - Table empty: any card.
 *  - Table non-empty: the card rank (or "joker") must already appear on the
 *    table — either as an attacker card or a defense card.
 */
export function canAttackWith(card: Card, attacks: readonly AttackEntry[]): boolean {
  if (attacks.length === 0) return true;
  const ranks = collectTableRanks(attacks);
  const key: number | 'joker' = card.kind === 'joker' ? 'joker' : card.rank;
  return ranks.has(key);
}

/**
 * Mirrors `ExclusiveThrowInPolicy` from the engine for UI gating only.
 *
 * Returns `true` when the viewer is currently locked out of throwing because
 * `settings.exclusiveThrowIn` is on AND someone else is the primary attacker
 * AND that primary attacker has not yet said "бито". Used to disable the
 * drag-to-attack interaction and to surface a transient hint when the viewer
 * tries anyway.
 *
 * Returns `false` when the lock doesn't apply (setting off, viewer IS the
 * primary, primary already pasted, primary is finished, primary has no
 * cards). The server is the source of truth — this is purely cosmetic
 * gating for snappier UX.
 */
export function isExclusiveThrowInLocked(state: ClientGameState, myUserId: string): boolean {
  if (state.settings.exclusiveThrowIn !== true) return false;
  if (!myUserId) return false;
  // The lock only restricts throw-in. The defender's actions (beat / translate
  // / take) are orthogonal to the throw-in policy — never dim their hand.
  if (state.currentDefenderId === myUserId) return false;
  // After game_over the redactor still carries currentAttackerId for podium
  // rendering, but the hand is inert — nothing to gate.
  if (state.status === 'game_over') return false;
  const primaryId = state.currentAttackerId;
  if (!primaryId) return false;
  if (primaryId === myUserId) return false;
  // Primary already pasted at some point during this bout — lock released
  // for the rest of the bout. We can't rely on `passedPlayerIds.includes(...)`
  // here: that list is wiped on every throw-in (and on take), so once another
  // thrower piles in after the primary's "бито" the primary id would be gone
  // and the UI would re-lock against everyone else. The server-side latch
  // (`exclusiveLockReleased`) survives those resets — mirror it.
  if (state.exclusiveLockReleased === true) return false;
  // Fallback for snapshots from a server that pre-dates the latch field —
  // best-effort check against `passedPlayerIds` so older replays / open
  // sockets keep working until the redeploy catches up.
  if (
    state.exclusiveLockReleased === undefined &&
    state.passedPlayerIds.includes(primaryId)
  ) {
    return false;
  }
  const primary = state.players.find((p) => p.id === primaryId);
  if (!primary) return false;
  if (primary.isFinished) return false;
  // Primary has no cards left → can't throw, treat as released.
  if (primary.handSize === 0) return false;
  return true;
}

/**
 * Can the defender legally translate the bout with `card`?
 *
 *  - All current attacks must be unbeaten (no defense cards yet).
 *  - Every attack must share the same rank (or all be jokers).
 *  - The card the defender is playing must match that rank too.
 *  - There must be at least one attack on the table.
 */
export function canTranslateWith(card: Card, attacks: readonly AttackEntry[]): boolean {
  if (attacks.length === 0) return false;
  if (attacks.some((a) => a.beatenBy !== null)) return false;
  const key: number | 'joker' = card.kind === 'joker' ? 'joker' : card.rank;
  for (const a of attacks) {
    const aKey: number | 'joker' = a.card.kind === 'joker' ? 'joker' : a.card.rank;
    if (aKey !== key) return false;
  }
  return true;
}

/**
 * Decides whether the viewer is allowed to raise a `notice_cheat` against the
 * given table entry. Mirrors the server-side authorisation rules so we don't
 * render the cheat-flag icon for players who couldn't act on it anyway. The
 * server remains authoritative and will reject any slip-through.
 *
 *  - Cheating disabled in this game → never.
 *  - Entry has a defense card (`beatenBy !== null`) — this is a "beat-cheat":
 *    everyone except the defender (who placed the beat) can call it out,
 *    regardless of `cheatNoticeScope` (this matches the engine's
 *    `defaultCheatPolicy.canNotice` branch for beat checks).
 *  - Entry is unbeaten — this is an "attack-cheat":
 *      • The player who placed it (`entry.attackerId`) cannot notice on
 *        themselves.
 *      • `cheatNoticeScope === 'defender_only'` → only the current defender
 *        may notice.
 *      • `cheatNoticeScope === 'all'` → everyone except the cheater can notice.
 *
 * `cheatAttemptsRemaining` is intentionally NOT a gate here: the backend
 * decrements the *cheater's* pool on a successful catch, not the noticer's, so
 * even a noticer with 0 attempts left should be able to file the claim and let
 * the server arbitrate.
 */
export function canPlayerNoticeEntry(
  state: ClientGameState,
  entry: AttackEntry,
  myUserId: string,
): boolean {
  if (state.settings.cheatingEnabled !== true) return false;
  if (!myUserId) return false;
  if (entry.beatenBy !== null) {
    // Beat-cheat: defender placed the beat — they can't accuse themselves.
    return myUserId !== state.currentDefenderId;
  }
  // Attack-cheat: cheater is the player who put this attack card down.
  const cheaterId = entry.attackerId;
  if (myUserId === cheaterId) return false;
  if (state.settings.cheatNoticeScope === 'defender_only') {
    return myUserId === state.currentDefenderId;
  }
  return true;
}

/**
 * Collects every rank (or `'joker'`) currently visible on the table — both
 * attack cards and defense cards.
 */
export function collectTableRanks(
  attacks: readonly AttackEntry[],
): Set<number | 'joker'> {
  const ranks = new Set<number | 'joker'>();
  for (const a of attacks) {
    if (a.card.kind === 'joker') ranks.add('joker');
    else ranks.add(a.card.rank);
    if (a.beatenBy) {
      if (a.beatenBy.kind === 'joker') ranks.add('joker');
      else ranks.add(a.beatenBy.rank);
    }
  }
  return ranks;
}
