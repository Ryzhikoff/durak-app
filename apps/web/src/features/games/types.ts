/**
 * Local type surface for the game UI. We re-export the engine types we need
 * (Card, GameStatus, GameCommand, DomainEvent, …) and add the `ClientGameState`
 * shape produced by the backend redactor. Everything imported from
 * `@durak/game-engine` is `import type` so the engine's runtime code does not
 * end up in the web bundle — only the type declarations are pulled in.
 */
import type {
  Card,
  DomainEvent,
  GameStatus,
  Suit,
  Table,
} from '@durak/game-engine';
import type {
  ChatMessage,
  ChatReactionUpdate,
  LobbySettings,
  PauseInfo,
} from '@durak/shared-types';

export type {
  AttackEntry,
  Card,
  DomainEvent,
  GameCommand,
  GameStatus,
  Rank,
  Suit,
  Table,
} from '@durak/game-engine';

export type {
  ChatMessage,
  ChatMessageReply,
  ChatReactionUpdate,
  GameConcedeCompletedPayload,
  GamePausedPayload,
  GamePauseVoteStartedPayload,
  GamePauseVoteUpdatePayload,
  GamePauseWaitExtendedPayload,
  GameResumedPayload,
  PauseInfo,
  PauseVote,
  PlayerReactionPayload,
} from '@durak/shared-types';

/** Mirrors `apps/api/src/modules/games/game-redactor.ts:ClientGamePlayer`. */
export interface ClientGamePlayer {
  id: string;
  nickname: string;
  avatarUrl: string | null;
  cardBackId: string;
  customCardBackUrl: string | null;
  handSize: number;
  /** Only populated for the viewer's own seat. */
  hand?: Card[];
  isFinished: boolean;
  /** 1-indexed finishing place once the player has exited. */
  finishPlace?: number;
  isPassed: boolean;
  cheatAttemptsRemaining: number;
}

/** Mirrors `apps/api/src/modules/games/game-redactor.ts:ClientGameState`. */
export interface ClientGameState {
  id: string;
  settings: LobbySettings;
  myUserId: string;
  status: GameStatus;
  trumpCard: Card | null;
  trumpSuit: Suit | null;
  deckSize: number;
  discardSize: number;
  table: Table;
  boutNumber: number;
  loserPlayerId: string | null;
  currentAttackerId: string;
  currentDefenderId: string;
  passedPlayerIds: string[];
  players: ClientGamePlayer[];
}

export interface GameSubscribePayload {
  state: ClientGameState;
  recentEvents: DomainEvent[];
  /** Last ~100 chat messages, oldest first. Empty when there's no history yet. */
  chatHistory: ChatMessage[];
  /** Phase 8 — current pause meta-state. Null when the game isn't paused. */
  pauseInfo: PauseInfo | null;
}

export interface GameChatMessageEvent {
  message: ChatMessage;
}

export type GameChatReactionEvent = ChatReactionUpdate;

export interface GameStateEvent {
  state: ClientGameState;
}

export interface GameEventsEvent {
  events: DomainEvent[];
}

export interface GameOverEvent {
  state: ClientGameState;
  events: DomainEvent[];
}
