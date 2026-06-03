import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PasswordHasher } from '../auth/password-hasher';
import { SessionService } from '../auth/session.service';

export interface AdminUserView {
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

function toView(u: User): AdminUserView {
  return {
    id: u.id,
    login: u.login,
    nickname: u.nickname,
    isAdmin: u.isAdmin,
    mustChangePassword: u.mustChangePassword,
    avatarUrl: u.avatarUrl,
    disabledAt: u.disabledAt ? u.disabledAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionService,
  ) {}

  async list(opts: { search?: string; page: number; limit: number }) {
    const where: Prisma.UserWhereInput = opts.search
      ? {
          OR: [
            { login: { contains: opts.search.toLowerCase() } },
            { nickname: { contains: opts.search, mode: 'insensitive' } },
          ],
        }
      : {};
    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (opts.page - 1) * opts.limit,
        take: opts.limit,
      }),
    ]);
    return {
      total,
      page: opts.page,
      limit: opts.limit,
      items: rows.map(toView),
    };
  }

  async create(input: {
    login: string;
    password: string;
    nickname?: string;
    isAdmin?: boolean;
  }): Promise<AdminUserView> {
    const login = input.login.trim().toLowerCase();
    const nickname = (input.nickname ?? login).trim();
    const [dupLogin, dupNick] = await Promise.all([
      this.prisma.user.findUnique({ where: { login } }),
      this.prisma.user.findUnique({ where: { nickname } }),
    ]);
    if (dupLogin) {
      throw new ConflictException({ code: 'LOGIN_TAKEN', message: 'Login already taken' });
    }
    if (dupNick) {
      throw new ConflictException({ code: 'NICKNAME_TAKEN', message: 'Nickname already taken' });
    }
    const passwordHash = await this.hasher.hash(input.password);
    const user = await this.prisma.user.create({
      data: {
        login,
        nickname,
        passwordHash,
        isAdmin: input.isAdmin ?? false,
        mustChangePassword: true,
      },
    });
    return toView(user);
  }

  async update(
    id: string,
    _actorId: string,
    patch: { nickname?: string; isAdmin?: boolean; disabled?: boolean },
  ): Promise<AdminUserView> {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    }
    if (patch.nickname && patch.nickname !== existing.nickname) {
      const dup = await this.prisma.user.findUnique({ where: { nickname: patch.nickname } });
      if (dup && dup.id !== id) {
        throw new ConflictException({ code: 'NICKNAME_TAKEN', message: 'Nickname already taken' });
      }
    }
    if (patch.isAdmin === false && existing.isAdmin) {
      // Prevent demoting the last active admin (regardless of who initiates it).
      const otherAdmins = await this.prisma.user.count({
        where: { isAdmin: true, id: { not: id }, disabledAt: null },
      });
      if (otherAdmins === 0) {
        throw new BadRequestException({
          code: 'LAST_ADMIN',
          message: 'Cannot demote the last active admin',
        });
      }
    }
    if (patch.disabled === true && existing.isAdmin && !existing.disabledAt) {
      // Disabling an active admin counts as removing them from the admin pool.
      const otherAdmins = await this.prisma.user.count({
        where: { isAdmin: true, id: { not: id }, disabledAt: null },
      });
      if (otherAdmins === 0) {
        throw new BadRequestException({
          code: 'LAST_ADMIN',
          message: 'Cannot disable the last active admin',
        });
      }
    }

    const data: Prisma.UserUpdateInput = {};
    if (patch.nickname !== undefined) data.nickname = patch.nickname;
    if (patch.isAdmin !== undefined) data.isAdmin = patch.isAdmin;
    if (patch.disabled !== undefined) {
      data.disabledAt = patch.disabled ? new Date() : null;
    }

    const updated = await this.prisma.user.update({ where: { id }, data });
    // If user was disabled or demoted -> invalidate their sessions.
    if (patch.disabled === true) {
      await this.sessions.destroyAllForUser(id);
    } else if (patch.isAdmin !== undefined) {
      // Update isAdmin in active sessions for that user (best-effort).
      const sessionRows = await this.prisma.session.findMany({
        where: { userId: id },
        select: { id: true },
      });
      for (const s of sessionRows) {
        await this.sessions.update(s.id, { isAdmin: patch.isAdmin });
      }
    }
    return toView(updated);
  }

  async resetPassword(id: string, newPassword: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    }
    const hash = await this.hasher.hash(newPassword);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: hash, mustChangePassword: true },
    });
    // Invalidate all sessions for the user — they must log in with the new password.
    await this.sessions.destroyAllForUser(id);
  }

  /**
   * Hard delete the user record (and cascade-delete dependent rows via FK).
   *
   * - 404 if the user does not exist.
   * - 400 SELF_DELETE if actor tries to delete themselves.
   * - 400 LAST_ADMIN if deleting would leave zero active admins.
   *
   * Redis sessions are wiped explicitly first; Session rows in Postgres are
   * removed via `ON DELETE CASCADE` on `Session.userId -> User.id`.
   */
  async remove(id: string, actorId: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    }
    if (id === actorId) {
      throw new BadRequestException({
        code: 'SELF_DELETE',
        message: 'Cannot delete yourself',
      });
    }
    if (existing.isAdmin) {
      const otherActiveAdmins = await this.prisma.user.count({
        where: { isAdmin: true, id: { not: id }, disabledAt: null },
      });
      if (otherActiveAdmins === 0) {
        throw new BadRequestException({
          code: 'LAST_ADMIN',
          message: 'Cannot remove the last active admin',
        });
      }
    }
    // Wipe Redis-resident session payloads first so concurrent requests
    // bearing this user's cookie can't outrun the DB delete.
    await this.sessions.destroyAllForUser(id);
    await this.prisma.user.delete({ where: { id } });
  }
}
