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

// ---------- Error envelope ----------

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
