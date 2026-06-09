import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  TEXT_REACTION_MAX_LENGTH,
  type AdminTextReactionDTO,
  type TextReaction,
} from '@durak/shared-types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

interface TextReactionRow {
  id: string;
  text: string;
  sortOrder: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface TextReactionPrismaSlice {
  textReaction: {
    findMany(args: {
      where?: { enabled?: boolean };
      orderBy?: Array<{ sortOrder?: 'asc' | 'desc' } | { id?: 'asc' | 'desc' }>;
    }): Promise<TextReactionRow[]>;
    findUnique(args: { where: { id: string } }): Promise<TextReactionRow | null>;
    create(args: {
      data: { text: string; sortOrder: number; enabled: boolean };
    }): Promise<TextReactionRow>;
    update(args: {
      where: { id: string };
      data: { text?: string; sortOrder?: number; enabled?: boolean };
    }): Promise<TextReactionRow>;
    delete(args: { where: { id: string } }): Promise<TextReactionRow>;
  };
}

export interface CreateTextReactionInput {
  text: string;
  sortOrder?: number;
  enabled?: boolean;
}

export interface UpdateTextReactionInput {
  text?: string;
  sortOrder?: number;
  enabled?: boolean;
}

/**
 * Admin-managed list of preset text "реакции". The picker on the game page
 * pulls the enabled subset; clicking one fires a transient bubble identical to
 * the emoji-reaction one but with a wrapped text body.
 *
 * Validation contract:
 *   - text is trimmed, then rejected if empty.
 *   - text length (post-trim) capped at {@link TEXT_REACTION_MAX_LENGTH}.
 *   - sortOrder defaults to 0 on create, untouched on omitted-PATCH.
 *   - enabled defaults to true on create, untouched on omitted-PATCH.
 *
 * The service exposes two read paths: full admin DTOs (with timestamps +
 * enabled flag) and a "public" subset (`listEnabled()`) used both by the
 * unauthenticated `GET /text-reactions` endpoint and by the gateway when
 * resolving an id-on-send.
 */
@Injectable()
export class AdminTextReactionsService {
  constructor(private readonly prisma: PrismaService) {}

  private slice(): TextReactionPrismaSlice {
    return this.prisma as unknown as TextReactionPrismaSlice;
  }

  /**
   * Trim, length-check and reject empty values. Throws a typed BadRequest with
   * the same error-code shape used everywhere else in the API.
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

  /** Full admin list (enabled + disabled), ordered for stable table display. */
  async list(): Promise<AdminTextReactionDTO[]> {
    const rows = await this.slice().textReaction.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toAdminDto);
  }

  /** Public list — only enabled rows, stripped of admin-only metadata. */
  async listEnabled(): Promise<TextReaction[]> {
    const rows = await this.slice().textReaction.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toPublicDto);
  }

  /**
   * Resolve an id to its current text. Returns null when the row is missing or
   * disabled — the WS handler uses this to validate before broadcasting.
   */
  async resolveEnabled(id: string): Promise<TextReaction | null> {
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) return null;
    const row = await this.slice().textReaction.findUnique({ where: { id } });
    if (!row || !row.enabled) return null;
    return toPublicDto(row);
  }

  async create(input: CreateTextReactionInput): Promise<AdminTextReactionDTO> {
    const text = AdminTextReactionsService.normalizeText(input.text);
    const sortOrder = AdminTextReactionsService.normalizeSortOrder(input.sortOrder, 0);
    const enabled = input.enabled === undefined ? true : input.enabled === true;
    const row = await this.slice().textReaction.create({
      data: { text, sortOrder, enabled },
    });
    return toAdminDto(row);
  }

  async update(id: string, input: UpdateTextReactionInput): Promise<AdminTextReactionDTO> {
    const existing = await this.slice().textReaction.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        code: 'TEXT_REACTION_NOT_FOUND',
        message: 'Text reaction not found',
      });
    }
    const data: { text?: string; sortOrder?: number; enabled?: boolean } = {};
    if (input.text !== undefined) {
      data.text = AdminTextReactionsService.normalizeText(input.text);
    }
    if (input.sortOrder !== undefined) {
      data.sortOrder = AdminTextReactionsService.normalizeSortOrder(
        input.sortOrder,
        existing.sortOrder,
      );
    }
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== 'boolean') {
        throw new BadRequestException({
          code: 'BAD_REQUEST',
          message: 'enabled must be a boolean',
        });
      }
      data.enabled = input.enabled;
    }
    const row = await this.slice().textReaction.update({ where: { id }, data });
    return toAdminDto(row);
  }

  async remove(id: string): Promise<{ id: string }> {
    const existing = await this.slice().textReaction.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        code: 'TEXT_REACTION_NOT_FOUND',
        message: 'Text reaction not found',
      });
    }
    await this.slice().textReaction.delete({ where: { id } });
    return { id };
  }
}

function toAdminDto(row: TextReactionRow): AdminTextReactionDTO {
  return {
    id: row.id,
    text: row.text,
    sortOrder: row.sortOrder,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPublicDto(row: TextReactionRow): TextReaction {
  return { id: row.id, text: row.text, sortOrder: row.sortOrder };
}
