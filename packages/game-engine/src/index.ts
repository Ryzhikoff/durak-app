/**
 * Public API for `@durak/game-engine`.
 *
 * Phase 5 will import from here; nothing else should reach into deep modules.
 */

// Core types.
export type {
  Card,
  StandardCard,
  JokerCard,
  JokerColor,
  Suit,
  Rank,
  Player,
  PlayerSeat,
  PlayerView,
  PlayerId,
  PlayerGameView,
  AttackEntry,
  Table,
  GameState,
  GameStatus,
  BoutOutcome,
  GameCommand,
  CommandResult,
  CommandSuccess,
  CommandFailure,
  CommandErrorCode,
  DomainEvent,
} from './types.js';

// Card helpers.
export {
  SUITS_36,
  RANKS_36,
  RANKS_52,
  beats,
  cardSortValue,
  isJoker,
  isStandard,
  makeJokerId,
  makeStandardId,
} from './deck/card.js';

// Deck primitives.
export { DefaultDeckFactory, defaultDeckFactory } from './deck/factory.js';
export type { IDeckFactory } from './deck/factory.js';
export { shuffle } from './deck/shuffle.js';

// RNG.
export { createRng } from './rng.js';
export type { Rng } from './rng.js';

// Strategy interfaces + defaults.
export { DefaultBeatRule, defaultBeatRule } from './strategies/beat-rule.js';
export type { IBeatRule } from './strategies/beat-rule.js';
export { DefaultTrumpSelector, defaultTrumpSelector } from './strategies/trump.js';
export type { ITrumpSelector, TrumpSelection } from './strategies/trump.js';
export {
  StandardDealStrategy,
  standardDealStrategy,
  STANDARD_HAND_SIZE,
} from './strategies/deal.js';
export type { IDealStrategy, DealResult } from './strategies/deal.js';
export {
  LowestTrumpFirstPlayer,
  RandomFirstPlayer,
  PreviousLoserFirstPlayer,
  firstPlayerFor,
} from './strategies/first-player.js';
export type { IFirstPlayerStrategy } from './strategies/first-player.js';
export {
  AllPlayersPolicy,
  AttackerOnlyPolicy,
  attackPolicyFor,
} from './strategies/attack-policy.js';
export type { IAttackPolicy } from './strategies/attack-policy.js';
export { DefaultTranslatePolicy, defaultTranslatePolicy } from './strategies/translate-policy.js';
export type { ITranslatePolicy, TranslateCheck } from './strategies/translate-policy.js';
export { DefaultFirstBoutLimit, defaultFirstBoutLimit } from './strategies/first-bout-limit.js';
export type { IFirstBoutLimit } from './strategies/first-bout-limit.js';
export { DefaultCheatPolicy, defaultCheatPolicy } from './strategies/cheat-policy.js';
export type { ICheatPolicy } from './strategies/cheat-policy.js';
export { IdentityRatingCalculator, identityRatingCalculator } from './strategies/rating.js';
export type { IRatingCalculator, RatingInput, RatingOutput } from './strategies/rating.js';

// State machine.
export { createGame } from './state/createGame.js';
export type { CreateGameInput, CreateGameDeps } from './state/createGame.js';
export { applyCommand } from './state/reducers.js';
export {
  refillHands,
  closeBoutBeaten,
  closeBoutTaken,
  checkGameOver,
  markFinishedPlayers,
  attacksRemaining,
  tableFullyBeaten,
  tableHasUnbeaten,
} from './state/transitions.js';
export type { RefillOptions } from './state/transitions.js';
export { filterEventsForPlayer } from './state/events.js';
