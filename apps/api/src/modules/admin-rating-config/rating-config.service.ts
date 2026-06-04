import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { RatingConfig } from '@durak/shared-types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** Hard defaults — matches `RatingConfig` model defaults. */
export interface RatingConfigDefaults {
  initialMu: number;
  initialSigma: number;
  beta: number;
  tau: number;
  drawProbability: number;
}

export const DEFAULT_RATING_CONFIG: RatingConfigDefaults = {
  initialMu: 25.0,
  initialSigma: 8.333333,
  beta: 4.166667,
  tau: 0.083333,
  drawProbability: 0.1,
};

const SINGLETON_ID = 'singleton';

interface RawRow {
  initialMu: number;
  initialSigma: number;
  beta: number;
  tau: number;
  drawProbability: number;
  updatedAt: Date;
  updatedById: string | null;
}

interface RatingConfigPrismaSlice {
  ratingConfig: {
    findUnique(args: { where: { id: string } }): Promise<RawRow | null>;
    upsert(args: {
      where: { id: string };
      create: RawRow & { id: string };
      update: Partial<RawRow>;
    }): Promise<RawRow>;
  };
}

@Injectable()
export class RatingConfigService implements OnModuleInit {
  private readonly logger = new Logger(RatingConfigService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ensure the singleton row exists on boot so `updatedAt` reflects a real
   * timestamp (not the epoch fallback) and any admin reading the config
   * before the first save sees defaults that are actually persisted.
   */
  async onModuleInit(): Promise<void> {
    try {
      const slice = this.prisma as unknown as RatingConfigPrismaSlice;
      const existing = await slice.ratingConfig.findUnique({ where: { id: SINGLETON_ID } });
      if (existing) return;
      await slice.ratingConfig.upsert({
        where: { id: SINGLETON_ID },
        create: {
          id: SINGLETON_ID,
          ...DEFAULT_RATING_CONFIG,
          updatedAt: new Date(),
          updatedById: null,
        },
        update: {},
      });
    } catch (err) {
      // Non-fatal: the API still boots; `get()` will return defaults until
      // someone calls update().
      this.logger.warn({ err }, 'RatingConfig seed failed; falling back to defaults');
    }
  }

  /** Read the singleton row, falling back to defaults when the row is absent. */
  async get(): Promise<RatingConfig> {
    const row = await (this.prisma as unknown as RatingConfigPrismaSlice).ratingConfig.findUnique({
      where: { id: SINGLETON_ID },
    });
    if (!row) {
      return {
        ...DEFAULT_RATING_CONFIG,
        updatedAt: new Date(0).toISOString(),
        updatedById: null,
      };
    }
    return toDto(row);
  }

  /**
   * Upsert the singleton, applying ONLY the provided fields. The whole row
   * must exist (with defaults) on first call — Prisma's `upsert` handles that
   * via the `create` payload.
   */
  async update(
    patch: Partial<RatingConfigDefaults>,
    updatedById: string | null,
  ): Promise<RatingConfig> {
    const updateData: Partial<RawRow> = {
      updatedById: updatedById ?? null,
    };
    if (patch.initialMu !== undefined) updateData.initialMu = patch.initialMu;
    if (patch.initialSigma !== undefined) updateData.initialSigma = patch.initialSigma;
    if (patch.beta !== undefined) updateData.beta = patch.beta;
    if (patch.tau !== undefined) updateData.tau = patch.tau;
    if (patch.drawProbability !== undefined) updateData.drawProbability = patch.drawProbability;
    const createData = {
      id: SINGLETON_ID,
      initialMu: patch.initialMu ?? DEFAULT_RATING_CONFIG.initialMu,
      initialSigma: patch.initialSigma ?? DEFAULT_RATING_CONFIG.initialSigma,
      beta: patch.beta ?? DEFAULT_RATING_CONFIG.beta,
      tau: patch.tau ?? DEFAULT_RATING_CONFIG.tau,
      drawProbability: patch.drawProbability ?? DEFAULT_RATING_CONFIG.drawProbability,
      updatedAt: new Date(),
      updatedById: updatedById ?? null,
    };
    const row = await (this.prisma as unknown as RatingConfigPrismaSlice).ratingConfig.upsert({
      where: { id: SINGLETON_ID },
      create: createData,
      update: updateData,
    });
    return toDto(row);
  }
}

function toDto(row: RawRow): RatingConfig {
  return {
    initialMu: row.initialMu,
    initialSigma: row.initialSigma,
    beta: row.beta,
    tau: row.tau,
    drawProbability: row.drawProbability,
    updatedAt: row.updatedAt.toISOString(),
    updatedById: row.updatedById,
  };
}
