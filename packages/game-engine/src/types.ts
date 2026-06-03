/**
 * Core domain types for the Translation Durak engine.
 *
 * Everything in this module is plain data (no classes, no mutation helpers).
 * Reducers and strategies in sibling modules read/return these shapes.
 */

import type { LobbySettings } from '@durak/shared-types';

// ---------- Cards ----------

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';

/**
 * Card ranks. 36-card deck uses 6..14 (J=11, Q=12, K=13, A=14).
 * 52-card deck additionally uses 2..5.
 */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export type JokerColor = 'red' | 'black';

export type StandardCard = {
  kind: 'standard';
  id: string;
  suit: Suit;
  rank: Rank;
};

export type JokerCard = {
  kind: 'joker';
  id: string;
  color: JokerColor;
};

export type Card = StandardCard | JokerCard;

// ---------- Players ----------

export type PlayerId = string;

export interface PlayerSeat {
  id: PlayerId;
  nickname: string;
}

export interface Player extends PlayerSeat {
  /** Server-only: full hand. Frontend gets only its own hand. */
  hand: Card[];
}

/** Public view shown to opponents. */
export interface PlayerView {
  id: PlayerId;
  nickname: string;
  handSize: number;
  finished: boolean;
}

// ---------- Table ----------

export interface AttackEntry {
  id: string;
  card: Card;
  /** null until defender beats it. */
  beatenBy: Card | null;
  /**
   * Player who placed this attack card on the table. Captured at the time the
   * entry was created so cheat-notice can correctly attribute the cheater
   * even after a translate (which rotates roles but leaves the prior entries
   * on the table).
   */
  attackerId: PlayerId;
}

export interface Table {
  attacks: AttackEntry[];
}

// ---------- Game state ----------

export type GameStatus =
  | 'dealing'
  | 'bout_attack' // waiting for first attack of a new bout
  | 'bout_defense' // waiting for defender to beat / take / translate
  | 'bout_settle' // defender beat everything; waiting for "пас" / extra throws
  | 'game_over';

export type BoutOutcome = 'beaten' | 'taken' | 'translated';

export interface GameState {
  id: string;
  settings: LobbySettings;
  players: Player[];
  /** Indices into `players`. */
  currentAttackerIndex: number;
  currentDefenderIndex: number;
  /**
   * Last visible card at the bottom of the deck. Stays visible until the deck
   * is fully drawn. Null only in pathological joker-only edge case.
   */
  trumpCard: Card | null;
  /** Always a real suit unless we hit the pathological case. */
  trumpSuit: Suit | null;
  /** Cards remaining in the draw pile. Top of pile = end of array. */
  deck: Card[];
  /** Beaten cards. */
  discard: Card[];
  table: Table;
  status: GameStatus;
  /** 1-indexed. The very first bout is `1`. */
  boutNumber: number;
  /**
   * Defender's hand size at the start of the current bout. Used for
   * `defender_hand` first-bout limit and translate-validation in bout 1.
   */
  initialDefenderHandSize: number;
  /** Players that ran out of cards, in finish order. */
  finishedPlayers: PlayerId[];
  /** Only set in `game_over` (null = draw / nobody is loser). */
  loserPlayerId: PlayerId | null;
  /**
   * Players who said "бито" / "pass" this bout. The bout ends once everyone
   * with the right to throw extra cards has passed.
   */
  passedPlayerIds: PlayerId[];
  /**
   * Remaining cheat-notice attempts per player for the current bout. Resets
   * to `settings.cheatAttempts` at the start of every bout.
   */
  cheatAttemptsRemaining: Record<PlayerId, number>;
  /** Seed snapshot for reproducibility / replay. */
  randSeed: number;
  /** Current PRNG state; advanced when the engine needs randomness. */
  rngState: number;
  /** Monotonic counter for entry ids on the table. */
  nextEntryId: number;
}

// ---------- Commands ----------

export type GameCommand =
  | { type: 'attack'; playerId: PlayerId; cardId: string }
  | {
      type: 'beat';
      playerId: PlayerId;
      attackEntryId: string;
      defenseCardId: string;
    }
  | { type: 'translate'; playerId: PlayerId; cardId: string }
  | { type: 'take'; playerId: PlayerId }
  | { type: 'pass'; playerId: PlayerId }
  | {
      type: 'notice_cheat';
      playerId: PlayerId;
      attackEntryId: string;
    };

// ---------- Errors ----------

export type CommandErrorCode =
  | 'INVALID_COMMAND'
  | 'NOT_YOUR_TURN'
  | 'CARD_NOT_IN_HAND'
  | 'CARD_DOES_NOT_BEAT'
  | 'CARD_RANK_NOT_ON_TABLE'
  | 'TRANSLATE_NOT_ALLOWED'
  | 'TAKE_NOT_ALLOWED'
  | 'PASS_NOT_ALLOWED'
  | 'ATTACK_LIMIT_REACHED'
  | 'ATTACK_NOT_ALLOWED'
  | 'BEAT_NOT_ALLOWED'
  | 'ENTRY_NOT_FOUND'
  | 'ENTRY_ALREADY_BEATEN'
  | 'CHEAT_DISABLED'
  | 'CHEAT_LIMIT'
  | 'GAME_OVER';

export interface CommandFailure {
  ok: false;
  code: CommandErrorCode;
  message: string;
}

export interface CommandSuccess {
  ok: true;
  state: GameState;
  events: DomainEvent[];
}

export type CommandResult = CommandSuccess | CommandFailure;

// ---------- Domain events ----------

export type DomainEvent =
  | { type: 'CardAttacked'; playerId: PlayerId; entryId: string; card: Card }
  | {
      type: 'CardBeaten';
      defenderId: PlayerId;
      attackEntryId: string;
      defenseCard: Card;
    }
  | { type: 'CardTranslated'; fromPlayerId: PlayerId; newDefenderId: PlayerId; card: Card }
  | { type: 'TablePassed'; sayerId: PlayerId }
  | { type: 'BoutEnded'; outcome: BoutOutcome; boutNumber: number }
  | { type: 'CardsTaken'; defenderId: PlayerId; count: number }
  | {
      type: 'PlayersDrew';
      draws: Array<{ playerId: PlayerId; count: number }>;
    }
  | { type: 'PlayerOut'; playerId: PlayerId; place: number }
  | {
      type: 'GameEnded';
      loserId: PlayerId | null;
      placements: Array<{ playerId: PlayerId; place: number }>;
    }
  | {
      type: 'CheatNoticed';
      noticerId: PlayerId;
      cheaterId: PlayerId | null;
      attackEntryId: string;
      succeeded: boolean;
    }
  | { type: 'TurnPassed'; newAttackerId: PlayerId; newDefenderId: PlayerId };

// ---------- Public views ----------

/** Snapshot trimmed down to what a specific player is allowed to see. */
export interface PlayerGameView {
  gameId: string;
  status: GameStatus;
  settings: LobbySettings;
  selfPlayerId: PlayerId;
  selfHand: Card[];
  opponents: PlayerView[];
  trumpCard: Card | null;
  trumpSuit: Suit | null;
  deckSize: number;
  discardSize: number;
  table: Table;
  currentAttackerId: PlayerId;
  currentDefenderId: PlayerId;
  boutNumber: number;
  passedPlayerIds: PlayerId[];
  cheatAttemptsRemaining: number;
  loserPlayerId: PlayerId | null;
  finishedPlayers: PlayerId[];
}
