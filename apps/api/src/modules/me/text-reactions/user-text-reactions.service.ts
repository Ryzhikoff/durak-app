import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  TEXT_REACTION_MAX_LENGTH,
  USER_TEXT_REACTION_MAX_PER_USER,
  type UserTextReactionDTO,
} from '@durak/shared-types';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

interface UserTextReactionRow {
  id: string;
  userId: string;
  text: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

interface UserTextReactionPrismaSlice {
  userTextReaction: {
    findMany(args: {
      where: { userId: string };
      orderBy?: Array<{ sortOrder?: 'asc' | 'desc' } | { id?: 'asc' | 'desc' }>;
    }): Promise<UserTextReactionRow[]>;
    findUnique(args: { where: { id: string } }): Promise<UserTextReactionRow | null>;
    count(args: { where: { userId: string } }): Promise<number>;
    create(args: {
      data: { userId: string; text: string; sortOrder: number };
    }): Promise<UserTextReactionRow>;
    update(args: {
      where: { id: string };
      data: { text?: string; sortOrder?: number };
    }): Promise<UserTextReactionRow>;
    delete(args: { where: { id: string } }): Promise<UserTextReactionRow>;
  };
}

export interface CreateUserTextReactionInput {
  text: string;
  sortOrder?: number;
}

export interface UpdateUserTextReactionInput {
  text?: string;
  sortOrder?: number;
}

/**
 * Per-user custom text reactions — owner-scoped CRUD that sits next to the
 * admin-managed global list. Validation contract mirrors
 * {@link AdminTextReactionsService}: text is trimmed, rejected if empty,
 * capped at {@link TEXT_REACTION_MAX_LENGTH}. A per-user cap
 * ({@link USER_TEXT_REACTION_MAX_PER_USER}) keeps the picker list bounded.
 *
 * `resolveOwn()` is the security-critical hot path: the WS gateway calls it
 * before broadcasting a user-custom reaction so a malicious client can't
 * impersonate someone else's saved phrase via a stolen id. The check is
 * `row && row.userId === senderUserId` — anything else returns null.
 */
@Injectable()
export class UserTextReactionsService {
  constructor(private readonly prisma: PrismaService) {}

  private slice(): UserTextReactionPrismaSlice {
    return this.prisma as unknown as UserTextReactionPrismaSlice;
  }

  /**
   * Trim, length-check and reject empty values. Throws a typed BadRequest with
   * the same error-code shape used by the admin equivalent.
   */
  static normalizeText(raw: unknown): string {
    if (typeof raw !== 'string') {
      throw new BadRequestException({
        code: 'TEXT_REACTION_EMPTY',
        message: 'Text is required',
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException({
        code: 'TEXT_REACTION_EMPTY',
        message: 'Text is required',
      });
    }
    if (trimmed.length > TEXT_REACTION_MAX_LENGTH) {
      throw new BadRequestException({
        code: 'TEXT_REACTION_TOO_LONG',
        message: `Text must be at most ${TEXT_REACTION_MAX_LENGTH} characters`,
      });
    }
    return trimmed;
  }

  private static normalizeSortOrder(raw: unknown, fallback: number): number {
    if (raw === undefined || raw === null) return fallback;
    if (typeof raw !== 'number' || !Number.isInteger(raw)) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'sortOrder must be an integer',
      });
    }
    return raw;
  }

  /** Owner-scoped list, ordered by (sortOrder ASC, id ASC). */
  async list(userId: string): Promise<UserTextReactionDTO[]> {
    const rows = await this.slice().userTextReaction.findMany({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDto);
  }

  /**
   * Resolve a reaction id to its text, but only if the row exists AND is owned
   * by `userId`. Returns null otherwise — the WS handler treats null as
   * "not your phrase / does not exist" and falls through to the not-found
   * error so we never leak existence of another user's row.
   */
  async resolveOwn(
    userId: string,
    id: string,
  ): Promise<{ id: string; text: string } | null> {
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) return null;
    if (typeof userId !== 'string' || userId.length === 0) return null;
    const row = await this.slice().userTextReaction.findUnique({ where: { id } });
    if (!row || row.userId !== userId) return null;
    return { id: row.id, text: row.text };
  }

  async create(
    userId: string,
    input: CreateUserTextReactionInput,
  ): Promise<UserTextReactionDTO> {
    const text = UserTextReactionsService.normalizeText(input.text);
    const sortOrder = UserTextReactionsService.normalizeSortOrder(input.sortOrder, 0);
    const existing = await this.slice().userTextReaction.count({ where: { userId } });
    if (existing >= USER_TEXT_REACTION_MAX_PER_USER) {
      throw new BadRequestException({
        code: 'USER_TEXT_REACTION_LIMIT_REACHED',
        message: `You can store at most ${USER_TEXT_REACTION_MAX_PER_USER} custom reactions`,
      });
    }
    const row = await this.slice().userTextReaction.create({
      data: { userId, text, sortOrder },
    });
    return toDto(row);
  }

  async update(
    userId: string,
    id: string,
    input: UpdateUserTextReactionInput,
  ): Promise<UserTextReactionDTO> {
    const existing = await this.slice().userTextReaction.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        code: 'USER_TEXT_REACTION_NOT_FOUND',
        message: 'Reaction not found',
      });
    }
    // Owner check — surface as NotFound (404) so callers can't probe ids.
    if (existing.userId !== userId) {
      throw new NotFoundException({
        code: 'USER_TEXT_REACTION_NOT_FOUND',
        message: 'Reaction not found',
      });
    }
    const data: { text?: string; sortOrder?: number } = {};
    if (input.text !== undefined) {
      data.text = UserTextReactionsService.normalizeText(input.text);
    }
    if (input.sortOrder !== undefined) {
      data.sortOrder = UserTextReactionsService.normalizeSortOrder(
        input.sortOrder,
        existing.sortOrder,
      );
    }
    const row = await this.slice().userTextReaction.update({ where: { id }, data });
    return toDto(row);
  }

  async remove(userId: string, id: string): Promise<{ id: string }> {
    const existing = await this.slice().userTextReaction.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException({
        code: 'USER_TEXT_REACTION_NOT_FOUND',
        message: 'Reaction not found',
      });
    }
    await this.slice().userTextReaction.delete({ where: { id } });
    return { id };
  }
}

function toDto(row: UserTextReactionRow): UserTextReactionDTO {
  return {
    id: row.id,
    text: row.text,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
  };
}

