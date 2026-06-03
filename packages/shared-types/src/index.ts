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

export interface ProfileStats {
  gamesPlayed: number;
  wins: number;
  lastPlaces: number;
  firstPlaceRate: number;
  lastPlaceRate: number;
  cheatAttempts: number;
  cheatCaught: number;
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
  /** Stubbed in Phase 2; populated in Phase 4+. */
  lastGames: GameSummary[];
  cardBackId: string;
  randomCardBack: boolean;
  customCardBackUrl: string | null;
}

// ---------- Games (stubs for Phase 2) ----------

export interface GameSummary {
  id: string;
  startedAt: string;
  endedAt: string | null;
  players: Array<{
    id: string;
    nickname: string;
    place: number | null;
  }>;
}

export interface GameDetail extends GameSummary {
  /** Reserved for the future game replay payload. */
  events: unknown[];
}

export interface GameListResponse extends Pagination {
  items: GameSummary[];
}

export interface GameListQuery {
  page?: number;
  limit?: number;
  playerId?: string;
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
  // Server -> Client (per-game room)
  state: 'game:state',
  events: 'game:events',
  over: 'game:over',
} as const;

export type GameEventName = (typeof GAME_EVENTS)[keyof typeof GAME_EVENTS];

// ---------- Error envelope ----------

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
