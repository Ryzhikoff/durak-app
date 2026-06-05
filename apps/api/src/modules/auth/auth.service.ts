import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { PasswordHasher } from './password-hasher';
import { SessionService } from './session.service';

/** Whitelist of allowed `handSortMode` values; mirrored on the wire. */
export type HandSortMode = 'power' | 'suit';

export interface PublicUser {
  id: string;
  login: string;
  nickname: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
  avatarUrl: string | null;
  cardBackId: string;
  randomCardBack: boolean;
  customCardBackUrl: string | null;
  /**
   * User-chosen hand sort strategy. Mirrors `User.handSortMode` in the
   * database. Server never re-sorts hands itself — the client picks a sort
   * function based on this flag.
   */
  handSortMode: HandSortMode;
  /**
   * Set to the gameId of the user's currently active (non-finished) game, if
   * any. Read from Redis `userInGame:<userId>` and cross-checked against the
   * `game:<id>` key so a stale pointer doesn't surface a dead game. Null
   * otherwise. See {@link AuthService.resolveCurrentGameId}.
   */
  currentGameId: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Look up the user's active game pointer in Redis and confirm the game state
   * still exists. Returns null when the pointer is missing or when the game it
   * references has aged out (stale pair — leave the orphan key alone, it will
   * expire on its own TTL).
   */
  async resolveCurrentGameId(userId: string): Promise<string | null> {
    const gameId = await this.redis.client.get(`userInGame:${userId}`);
    if (!gameId) return null;
    const exists = await this.redis.client.exists(`game:${gameId}`);
    if (!exists) return null;
    return gameId;
  }

  toPublicUser(
    u: {
      id: string;
      login: string;
      nickname: string;
      isAdmin: boolean;
      mustChangePassword: boolean;
      avatarUrl: string | null;
      cardBackId: string;
      randomCardBack: boolean;
      customCardBackUrl: string | null;
      handSortMode: string;
    },
    currentGameId: string | null = null,
  ): PublicUser {
    return {
      id: u.id,
      login: u.login,
      nickname: u.nickname,
      isAdmin: u.isAdmin,
      mustChangePassword: u.mustChangePassword,
      avatarUrl: u.avatarUrl,
      cardBackId: u.cardBackId,
      randomCardBack: u.randomCardBack,
      customCardBackUrl: u.customCardBackUrl,
      // Defensive: any non-'suit' value falls back to the legacy 'power' mode.
      handSortMode: u.handSortMode === 'suit' ? 'suit' : 'power',
      currentGameId,
    };
  }

  async login(
    rawLogin: string,
    password: string,
    meta: { userAgent?: string; ip?: string },
  ): Promise<{ user: PublicUser; sessionId: string; ttlSeconds: number }> {
    const login = rawLogin.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { login } });
    if (!user) {
      // Constant-ish-time path: still run a verify against a dummy hash to avoid
      // user-enumeration timing differences. Cheap because argon2 dominates.
      await this.hasher
        .verify(
          '$argon2id$v=19$m=65536,t=3,p=1$ZHVtbXlzYWx0ZHVtbXlzYWx0$dummydummydummydummydummydummydummydummydummy',
          password,
        )
        .catch(() => false);
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid login or password',
      });
    }
    if (user.disabledAt) {
      throw new ForbiddenException({ code: 'ACCOUNT_DISABLED', message: 'Account disabled' });
    }
    const ok = await this.hasher.verify(user.passwordHash, password);
    if (!ok) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid login or password',
      });
    }
    const { id: sessionId, ttlSeconds } = await this.sessions.create({
      userId: user.id,
      isAdmin: user.isAdmin,
      mustChangePassword: user.mustChangePassword,
      userAgent: meta.userAgent,
      ip: meta.ip,
    });
    const currentGameId = await this.resolveCurrentGameId(user.id);
    return { user: this.toPublicUser(user, currentGameId), sessionId, ttlSeconds };
  }

  async logout(sessionId: string | undefined): Promise<void> {
    if (!sessionId) return;
    await this.sessions.destroy(sessionId);
  }

  async getMe(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Session invalid' });
    }
    if (user.disabledAt) {
      throw new ForbiddenException({ code: 'ACCOUNT_DISABLED', message: 'Account disabled' });
    }
    const currentGameId = await this.resolveCurrentGameId(user.id);
    return this.toPublicUser(user, currentGameId);
  }

  async changePassword(
    userId: string,
    sessionId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Session invalid' });
    }
    // mustChangePassword still requires the user to type their current password
    // (admin-issued one). This is consistent and avoids accidental skip.
    const ok = await this.hasher.verify(user.passwordHash, currentPassword);
    if (!ok) {
      throw new BadRequestException({
        code: 'INVALID_CURRENT_PASSWORD',
        message: 'Current password is incorrect',
      });
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException({
        code: 'NEW_PASSWORD_SAME_AS_CURRENT',
        message: 'New password must differ from current',
      });
    }
    const newHash = await this.hasher.hash(newPassword);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash, mustChangePassword: false },
    });
    await this.sessions.update(sessionId, { mustChangePassword: false });
    // Invalidate all OTHER sessions of this user — the current session stays valid
    // so the user remains logged in after password change.
    await this.sessions.destroyAllForUserExcept(userId, sessionId);
    const currentGameId = await this.resolveCurrentGameId(userId);
    return this.toPublicUser(updated, currentGameId);
  }
}
