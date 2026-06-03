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

// ---------- Error envelope ----------

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
