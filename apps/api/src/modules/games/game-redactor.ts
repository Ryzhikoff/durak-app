import type { Card, GameState, GameStatus, PlayerId, Suit, Table } from '@durak/game-engine';
import type { LobbySettings } from '@durak/shared-types';

/**
 * User-profile slice persisted alongside the game state so we can render the
 * scoreboard (avatar, card-back) without re-querying Postgres on every emit.
 *
 * Stored in Redis under `game:<id>:profiles` (single JSON blob). See
 * {@link GamesService.createFromLobby} for how it's populated.
 */
export interface GameUserProfile {
  /** Mirrors `User.nickname`. Kept here so a renamed user keeps their in-game name. */
  nickname: string;
  avatarUrl: string | null;
  cardBackId: string;
  customCardBackUrl: string | null;
}

export type GameUserProfiles = Record<string, GameUserProfile>;

/**
 * Per-player snapshot that's safe to broadcast. Hides:
 *  - opponents' hands (only `handSize` is exposed),
 *  - the remaining deck (only `deckSize`),
 *  - the discard pile (only `discardSize`),
 *  - rng internals (`randSeed`, `rngState`),
 *  - internal counters (`nextEntryId`, `initialDefenderHandSize`).
 *
 * The trump CARD on the table bottom is public (everyone has seen it), and the
 * table itself is fully visible by the rules of the game.
 */
export interface ClientGameState {
  id: string;
  settings: LobbySettings;
  /** The viewer's user id. Lets the client identify itself in the players array. */
  myUserId: PlayerId;
  status: GameStatus;
  trumpCard: Card | null;
  trumpSuit: Suit | null;
  deckSize: number;
  discardSize: number;
  table: Table;
  boutNumber: number;
  loserPlayerId: PlayerId | null;
  currentAttackerId: PlayerId;
  currentDefenderId: PlayerId;
  passedPlayerIds: PlayerId[];
  /**
   * Mirror of {@link GameState.exclusiveLockReleased}. Lets the client
   * disable / enable hand-drag gating for `exclusiveThrowIn` without having
   * to re-derive the latch from `passedPlayerIds` (which gets wiped on every
   * throw-in).
   */
  exclusiveLockReleased: boolean;
  players: ClientGamePlayer[];
  /**
   * True when the snapshot is built for a spectator (a logged-in user who is
   * not seated in the game). Spectators see the public board (table, deck size,
   * trump, hand sizes, finished/passed flags) but never any actual cards from
   * any hand. Undefined / false for the seated-player snapshot.
   */
  isSpectator?: boolean;
}

/**
 * Sentinel `viewerUserId` value passed to {@link redactForPlayer} to request
 * a spectator snapshot — no hand is revealed for any player.
 */
export const SPECTATOR_VIEWER_ID = '__spectator__' as const;

export interface ClientGamePlayer {
  id: PlayerId;
  nickname: string;
  avatarUrl: string | null;
  cardBackId: string;
  customCardBackUrl: string | null;
  handSize: number;
  /** Only populated when `id === myUserId`. */
  hand?: Card[];
  isFinished: boolean;
  /** 1-indexed finishing place once the player has exited. */
  finishPlace?: number;
  /** Did this player say "бито" / "pass" in the current bout? */
  isPassed: boolean;
  /** Remaining cheat-notice attempts for the current bout. */
  cheatAttemptsRemaining: number;
}

const EMPTY_PROFILE: GameUserProfile = {
  nickname: '',
  avatarUrl: null,
  cardBackId: 'classic-1',
  customCardBackUrl: null,
};

/**
 * Build a per-viewer snapshot from the canonical {@link GameState}. Pure
 * function — safe to call repeatedly per-socket on every change.
 *
 * The viewer is identified by `viewerUserId`. Two behaviours:
 *  - Seated player (own id is in `state.players`): their hand is included,
 *    every opponent's hand stays hidden.
 *  - Spectator / unseated viewer (id absent, or {@link SPECTATOR_VIEWER_ID}):
 *    no hand is revealed for any player and the returned snapshot is flagged
 *    with `isSpectator = true` so the client can render the read-only UI.
 *    The `myUserId` field carries the literal sentinel — clients should look
 *    at `isSpectator` rather than try to match `myUserId` against `players`.
 */
export function redactForPlayer(
  state: GameState,
  viewerUserId: PlayerId,
  profiles: GameUserProfiles,
): ClientGameState {
  const attacker = state.players[state.currentAttackerIndex];
  const defender = state.players[state.currentDefenderIndex];
  const finishedSet = new Set(state.finishedPlayers);
  const passedSet = new Set(state.passedPlayerIds);
  const seatedIds = new Set(state.players.map((p) => p.id));
  // A viewer who isn't seated is treated as a spectator regardless of which
  // id they supplied — the existing behaviour (no hand revealed) is preserved,
  // and the explicit `isSpectator` flag lets the client switch off
  // hand-rendering / command UIs.
  const isSpectator = viewerUserId === SPECTATOR_VIEWER_ID || !seatedIds.has(viewerUserId);

  const players: ClientGamePlayer[] = state.players.map((p) => {
    const profile = profiles[p.id] ?? { ...EMPTY_PROFILE, nickname: p.nickname };
    const finishPlaceIdx = state.finishedPlayers.indexOf(p.id);
    const out: ClientGamePlayer = {
      id: p.id,
      nickname: profile.nickname || p.nickname,
      avatarUrl: profile.avatarUrl,
      cardBackId: profile.cardBackId,
      customCardBackUrl: profile.customCardBackUrl,
      handSize: p.hand.length,
      isFinished: finishedSet.has(p.id),
      isPassed: passedSet.has(p.id),
      cheatAttemptsRemaining: state.cheatAttemptsRemaining[p.id] ?? 0,
    };
    // Only seated viewers get their own hand. Spectators never see any hand.
    if (!isSpectator && p.id === viewerUserId) {
      // Defensive copy so consumers cannot mutate engine state via the snapshot.
      out.hand = p.hand.slice();
    }
    if (finishPlaceIdx !== -1) {
      out.finishPlace = finishPlaceIdx + 1;
    }
    return out;
  });

  const snapshot: ClientGameState = {
    id: state.id,
    settings: state.settings,
    myUserId: viewerUserId,
    status: state.status,
    trumpCard: state.trumpCard,
    trumpSuit: state.trumpSuit,
    deckSize: state.deck.length,
    discardSize: state.discard.length,
    table: state.table,
    boutNumber: state.boutNumber,
    loserPlayerId: state.loserPlayerId,
    currentAttackerId: attacker?.id ?? '',
    currentDefenderId: defender?.id ?? '',
    passedPlayerIds: state.passedPlayerIds.slice(),
    exclusiveLockReleased: state.exclusiveLockReleased === true,
    players,
  };
  if (isSpectator) snapshot.isSpectator = true;
  return snapshot;
}
