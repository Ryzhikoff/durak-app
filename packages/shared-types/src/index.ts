/**
 * Shared DTOs between the Durak backend (NestJS) and the Web frontend.
 * Types mirror what the API actually returns / accepts.
 */

// ---------- User (self / public view) ----------

export interface User {
  id: string;
  login: string;
  nickname: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
  avatarUrl: string | null;
  cardBackId: string;
  randomCardBack: boolean;
  customCardBackUrl: string | null;
}

export interface AuthMeResponse {
  user: User;
}

export interface AuthLoginResponse {
  user: User;
}

export interface LoginRequest {
  login: string;
  password: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface UpdateMeRequest {
  nickname?: string;
  cardBackId?: string;
  randomCardBack?: boolean;
}

// ---------- Admin setup ----------

export interface AdminSetupStatusResponse {
  available: boolean;
}

export interface AdminSetupRequest {
  login: string;
  password: string;
  nickname?: string;
}

// ---------- Admin users CRUD ----------

export interface AdminUserDTO {
  id: string;
  login: string;
  nickname: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
  avatarUrl: string | null;
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
}

export interface AdminUserListResponse extends Pagination {
  items: AdminUserDTO[];
}

export interface AdminUserListQuery {
  search?: string;
  page?: number;
  limit?: number;
}

export interface CreateAdminUserRequest {
  login: string;
  password: string;
  nickname?: string;
  isAdmin?: boolean;
}

export interface UpdateAdminUserRequest {
  nickname?: string;
  isAdmin?: boolean;
  /** true = disable, false = re-enable */
  disabled?: boolean;
}

export interface ResetPasswordRequest {
  newPassword: string;
}

// ---------- Card backs ----------

/**
 * Card-back metadata. Rendering is done on the frontend (CSS / SVG) so the
 * backend only ships definitions: kind (always "pattern" for now), the two
 * primary colors and a pattern name.
 */
export type CardBackPattern =
  | 'dots'
  | 'grid'
  | 'stripes'
  | 'crosshatch'
  | 'chevron'
  | 'wave'
  | 'plain';

export interface CardBackDef {
  id: string;
  name: string;
  kind: 'pattern';
  colors: [string, string];
  pattern: CardBackPattern;
}

export interface CardBacksListResponse {
  items: CardBackDef[];
  /** Stable sentinel id the frontend can use for the "random" option. */
  randomOptionId: string;
}

/**
 * Stable sentinel id meaning "use the user-uploaded custom card back".
 * When `User.cardBackId === CUSTOM_CARD_BACK_ID`, the renderer should look at
 * `User.customCardBackUrl`. Persisted in DB; rejected if the user has no
 * upload (see `CUSTOM_CARD_BACK_NOT_SET` error).
 */
export const CUSTOM_CARD_BACK_ID = '__custom__';

// ---------- Rating ----------

export interface RatingEntry {
  id: string;
  nickname: string;
  avatarUrl: string | null;
  /** Conservative TrueSkill rating: round(mu - 3*sigma). */
  rating: number;
  /** Filled in Phase 4+; 0 for now. */
  gamesPlayed: number;
  lastSeenAt: string | null;
}

export interface RatingListResponse extends Pagination {
  items: RatingEntry[];
}

export interface RatingListQuery {
  page?: number;
  limit?: number;
}

// ---------- Public profile ----------

/**
 * Per-profile aggregate stats. Phase 7A added the cheat/translate/take
 * counters — they're optional on the wire so a Phase-2 client still
 * compiles. Server fills them in when game history exists.
 */
export interface ProfileStats {
  gamesPlayed: number;
  wins: number;
  lastPlaces: number;
  firstPlaceRate: number;
  lastPlaceRate: number;
  /** Total illegal plays this player attempted (caught + escaped). */
  cheatAttempts: number;
  /** Of those, how many were caught by another player's notice_cheat. */
  cheatCaught: number;
  /** Of those, how many slipped through to bout close. */
  cheatEscaped?: number;
  /** Notice_cheat clicks issued. */
  noticesIssued?: number;
  /** Of those, succeeded (real cheat). */
  noticesCorrect?: number;
  /** Of those, false alarms. */
  noticesWrong?: number;
  /** Total translate moves performed. */
  translatesMade?: number;
  /** Number of "беру" decisions made as defender. */
  takesAsked?: number;
  /** Total cards picked up via "беру". */
  cardsTaken?: number;
  /** Total attack actions performed across all games (Phase 7A.1). */
  attacksMade?: number;
  /** Total successful beat actions performed (Phase 7A.1). */
  beatsMade?: number;
  /** Bouts entered as the attacker (Phase 7A.1). */
  boutsAttacked?: number;
  /** Bouts entered as the defender (Phase 7A.1). */
  boutsDefended?: number;
}

export interface PublicProfile {
  id: string;
  nickname: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  /** Conservative TrueSkill rating: round(mu - 3*sigma). */
  rating: number;
  trueskill: {
    mu: number;
    sigma: number;
  };
  stats: ProfileStats;
  /** Most recent finished games for this profile (server-capped). */
  lastGames: GameSummary[];
  cardBackId: string;
  randomCardBack: boolean;
  customCardBackUrl: string | null;
}

// ---------- Games (Phase 7A — history) ----------

/**
 * Phase 7A summary. We keep the legacy `players` field (Phase 2 frontend) and
 * add Phase 7A extras: `finishedAt`, `durationSec`, etc. Existing UIs continue
 * to read `players[].nickname` / `startedAt`; new UIs can use the richer data.
 */
export interface GameSummaryPlayer {
  id: string;
  nickname: string;
  avatarUrl?: string | null;
  /** null for unfinished games (none exist in Phase 7A but kept for legacy). */
  place: number | null;
  isWinner?: boolean;
  isLoser?: boolean;
}

export interface GameSummary {
  id: string;
  startedAt: string;
  /** Phase 2 legacy: `endedAt`. Phase 7A always populated. */
  endedAt: string | null;
  /** Phase 7A alias for `endedAt`. */
  finishedAt?: string;
  durationSec?: number;
  playerCount?: number;
  loserId?: string | null;
  totalBouts?: number;
  settings?: LobbySettings;
  players: GameSummaryPlayer[];
}

/** Per-game stats snapshot for a single participant. */
export interface GameParticipantMetrics {
  attacksMade: number;
  beatsMade: number;
  translatesMade: number;
  takesAsked: number;
  cardsTaken: number;
  boutsAttacked: number;
  boutsDefended: number;
  cheatAttemptedTotal: number;
  cheatCaught: number;
  cheatEscaped: number;
  noticesIssued: number;
  noticesCorrect: number;
  noticesWrong: number;
}

export interface GameParticipantPublic {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  seatIndex: number;
  place: number;
  isWinner: boolean;
  isLoser: boolean;
  muBefore: number;
  sigmaBefore: number;
  muAfter: number;
  sigmaAfter: number;
  deltaDisplay: number;
  metrics: GameParticipantMetrics;
}

export interface GameDetail {
  id: string;
  settings: LobbySettings;
  startedAt: string;
  finishedAt: string;
  durationSec: number;
  loserId: string | null;
  totalBouts: number;
  participants: GameParticipantPublic[];
}

export interface GameListResponse extends Pagination {
  items: GameSummary[];
}

export interface GameListQuery {
  page?: number;
  limit?: number;
  playerId?: string;
}

/**
 * Phase 7B — list of past finished games played by the exact same set of
 * participants as a given reference game (same size + same userId set).
 */
export interface SameCompositionResponse {
  items: GameSummary[];
  total: number;
}

// ---------- Admin: rating config ----------

export interface RatingConfig {
  initialMu: number;
  initialSigma: number;
  beta: number;
  tau: number;
  drawProbability: number;
  updatedAt: string;
  updatedById: string | null;
}

export interface UpdateRatingConfigRequest {
  initialMu?: number;
  initialSigma?: number;
  beta?: number;
  tau?: number;
  drawProbability?: number;
}

// ---------- Lobby (Phase 3) ----------

/**
 * Per-lobby game rules. Defaults live in {@link DEFAULT_LOBBY_SETTINGS}.
 * Any participant of a waiting lobby may edit these (no host concept).
 */
export interface LobbySettings {
  maxPlayers: 2 | 3 | 4 | 5 | 6;
  /**
   * Maximum number of attack cards in the very first bout of the game.
   * - `5` | `6` — fixed cap.
   * - `'defender_hand'` — equal to the number of cards in the defender's hand
   *   at the start of the bout (i.e. the dealt hand size, 6).
   * Allowed values: see {@link ALLOWED_FIRST_BOUT_LIMITS}.
   */
  firstBoutLimit: 5 | 6 | 'defender_hand';
  attackerScope: 'all' | 'attacker_only';
  cheatingEnabled: boolean;
  /** 1..10. Ignored when cheatingEnabled === false. */
  cheatAttempts: number;
  cheatNoticeScope: 'defender_only' | 'all';
  layoutOnRepeat: 'random' | 'preserve';
  firstTurn: 'lowest_trump' | 'random' | 'previous_loser';
  deckSize: 36 | 52;
  jokers: boolean;
  /** null = off. Allowed values: see {@link ALLOWED_TURN_TIMERS}. */
  turnTimer: number | null;
}

export const LOBBY_PLAYER_COUNTS = [2, 3, 4, 5, 6] as const;
export const ALLOWED_TURN_TIMERS = [null, 30, 60, 120] as const;
export const ALLOWED_FIRST_BOUT_LIMITS = [5, 6, 'defender_hand'] as const;

export const DEFAULT_LOBBY_SETTINGS: LobbySettings = {
  maxPlayers: 6,
  firstBoutLimit: 5,
  attackerScope: 'all',
  cheatingEnabled: true,
  cheatAttempts: 1,
  cheatNoticeScope: 'defender_only',
  layoutOnRepeat: 'random',
  firstTurn: 'lowest_trump',
  deckSize: 36,
  jokers: false,
  turnTimer: null,
};

export type LobbyStatus = 'waiting' | 'starting' | 'in_game';

export interface LobbyPlayer {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  isReady: boolean;
}

export interface Lobby {
  id: string;
  createdAt: string;
  status: LobbyStatus;
  settings: LobbySettings;
  players: LobbyPlayer[];
  /** Populated once status flips to 'in_game'. Phase 4 will use it. */
  gameId: string | null;
}

/** Same shape as {@link Lobby} plus convenience aggregates for the list view. */
export interface LobbySummary extends Lobby {
  playerCount: number;
  maxPlayers: LobbySettings['maxPlayers'];
}

/**
 * WebSocket namespace handling all lobby traffic.
 * Mounted by nginx as `/socket.io/` and exposed by the API on the
 * `/lobbies` namespace.
 */
export const LOBBY_NAMESPACE = '/lobbies' as const;

/**
 * Canonical WS event names. Use these from both ends to avoid string typos.
 */
export const LOBBY_EVENTS = {
  // Client -> Server
  subscribe: 'lobbies:subscribe',
  unsubscribe: 'lobbies:unsubscribe',
  join: 'lobby:join',
  leave: 'lobby:leave',
  updateSettings: 'lobby:update_settings',
  setReady: 'lobby:set_ready',
  start: 'lobby:start',
  // Server -> Client (lobby room)
  state: 'lobby:state',
  started: 'lobby:started',
  deleted: 'lobby:deleted',
  // Server -> Client (list room)
  list: 'lobbies:list',
  added: 'lobbies:added',
  updated: 'lobbies:updated',
  removed: 'lobbies:removed',
} as const;

export type LobbyEventName = (typeof LOBBY_EVENTS)[keyof typeof LOBBY_EVENTS];

// ---------- Live games (Phase 5) ----------

/**
 * WebSocket namespace for the live game traffic. Mounted by nginx as
 * `/socket.io/`; the API exposes it under the `/games` namespace.
 */
export const GAME_NAMESPACE = '/games' as const;

/**
 * Canonical WS event names for live games. Use these from both ends to avoid
 * string typos.
 */
export const GAME_EVENTS = {
  // Client -> Server
  subscribe: 'game:subscribe',
  command: 'game:command',
  chatSend: 'game:chat_send',
  chatFetch: 'game:chat_fetch',
  chatReact: 'game:chat_react',
  // Server -> Client (per-game room)
  state: 'game:state',
  events: 'game:events',
  over: 'game:over',
  chatMessage: 'game:chat_message',
  chatReaction: 'game:chat_reaction',
  /**
   * Public game-over broadcast — fanned out to every socket connected to the
   * `/games` namespace, NOT just per-game room members. Payload is the minimum
   * needed to drive cache invalidation on the rating / recent-games pages:
   * `{ gameId, finishedAt }`. The per-participant `over` event still carries
   * the full personalised state.
   */
  overPublic: 'game:over_public',
} as const;

export type GameEventName = (typeof GAME_EVENTS)[keyof typeof GAME_EVENTS];

/** Payload of the public `game:over_public` broadcast. */
export interface GameOverPublicPayload {
  gameId: string;
  /** ISO 8601 timestamp of finalization. */
  finishedAt: string;
}

/**
 * Snapshot of the reply target denormalised onto the replying message at write
 * time. We never resolve the original message at read time — if the target was
 * trimmed out of history the snapshot is still enough to render the quote.
 */
export interface ChatMessageReply {
  messageId: string;
  userId: string;
  nickname: string;
  /** First 80 characters of the target text, trimmed. */
  textSnippet: string;
}

/**
 * In-game chat message. Lives only in Redis alongside the game state; reaped
 * by TTL when the game ends. The nickname / avatarUrl are denormalised at
 * write time so the renderer doesn't need to resolve profiles on read.
 */
export interface ChatMessage {
  id: string;
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  text: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** Optional snapshot of the message we're replying to. */
  replyTo: ChatMessageReply | null;
  /**
   * Reactions to this message. Key = userId of the reactor, value = chosen
   * emoji from {@link EMOJI_REACTIONS}. One reaction per user — the latest
   * write overrides the previous one (or removes it when the same emoji is
   * clicked again).
   */
  reactions: Record<string, string>;
}

/** Hard cap matches the backend validator; mirrored on the client for UX. */
export const CHAT_MESSAGE_MAX_LENGTH = 280;
/** Server-side rolling window of the most recent messages we keep per game. */
export const CHAT_HISTORY_LIMIT = 100;
/** Max length of the denormalised replyTo text snippet. */
export const CHAT_REPLY_SNIPPET_MAX_LENGTH = 80;

/**
 * Whitelist of allowed reaction emojis. The picker uses the same list so what
 * the user sees is exactly what the server will accept. The clown 🤡 is in.
 */
export const EMOJI_REACTIONS = [
  '\u{1F600}', // grinning
  '\u{1F602}', // joy
  '\u{1F923}', // rofl
  '\u{1F60A}', // blush
  '\u{1F60D}', // heart eyes
  '\u{1F618}', // kiss
  '\u{1F60E}', // sunglasses
  '\u{1F914}', // thinking
  '\u{1F928}', // raised brow
  '\u{1F634}', // sleeping
  '\u{1F62D}', // sob
  '\u{1F631}', // scream
  '\u{1F621}', // pouting
  '\u{1F92C}', // cursing
  '\u{1F92F}', // exploding head
  '\u{1F929}', // star eyes
  '\u{1F973}', // partying
  '\u{1F91D}', // handshake
  '\u{1F44D}', // thumbs up
  '\u{1F44E}', // thumbs down
  '\u{1F44F}', // clap
  '\u{1F64C}', // raised hands
  '\u{1F64F}', // folded hands
  '\u{1F4AA}', // muscle
  '❤️', // red heart
  '\u{1F525}', // fire
  '✨', // sparkles
  '\u{1F4AF}', // 100
  '\u{1F389}', // party popper
  '\u{1F0CF}', // joker card
  '\u{1F921}', // clown face
] as const;

export type ChatReactionEmoji = (typeof EMOJI_REACTIONS)[number];

/** Server -> client broadcast payload for a reaction change. */
export interface ChatReactionUpdate {
  messageId: string;
  userId: string;
  /** null = the reaction was removed. */
  emoji: string | null;
}

// ---------- Error envelope ----------

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
