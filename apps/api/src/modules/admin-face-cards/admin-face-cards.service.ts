import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Allowed face-card rank slugs. We use full lowercase names rather than the
 * numeric ranks 11/12/13 so URLs are self-documenting (`/uploads/face-cards/
 * jack-spades.webp`) and the admin UI can localise the slot label without
 * touching slug values.
 */
export const FACE_CARD_RANKS = ['jack', 'queen', 'king'] as const;
export type FaceCardRank = (typeof FACE_CARD_RANKS)[number];

export const FACE_CARD_SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
export type FaceCardSuit = (typeof FACE_CARD_SUITS)[number];

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024;
/** Card-face aspect ratio matches the existing custom card-back (5:7). */
const TARGET_WIDTH = 360;
const TARGET_HEIGHT = 504;
const TARGET_QUALITY = 85;
const UPLOAD_SUBDIR = 'face-cards';

export interface FaceCardAssetDto {
  rank: FaceCardRank;
  suit: FaceCardSuit;
  url: string | null;
}

interface FaceCardAssetRow {
  rank: string;
  suit: string;
  url: string;
}

interface FaceCardAssetPrismaSlice {
  faceCardAsset: {
    findMany(): Promise<FaceCardAssetRow[]>;
    findUnique(args: {
      where: { rank_suit: { rank: string; suit: string } };
    }): Promise<FaceCardAssetRow | null>;
    upsert(args: {
      where: { rank_suit: { rank: string; suit: string } };
      create: { rank: string; suit: string; url: string; uploadedById: string | null };
      update: { url: string; uploadedById: string | null };
    }): Promise<FaceCardAssetRow>;
    delete(args: {
      where: { rank_suit: { rank: string; suit: string } };
    }): Promise<FaceCardAssetRow>;
  };
}

/**
 * Admin-uploaded face-card images (J/Q/K × 4 suits). Pipeline mirrors the
 * per-user `CustomCardBackService` but the file lives under a deterministic
 * `<rank>-<suit>.webp` name (one global asset, not per-user), and the DB row
 * is keyed by the (rank, suit) pair via the `@@unique` index.
 */
@Injectable()
export class AdminFaceCardsService {
  private readonly logger = new Logger(AdminFaceCardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private uploadsRoot(): string {
    return this.config.get<string>('UPLOADS_DIR') ?? '/data/uploads';
  }

  private slice(): FaceCardAssetPrismaSlice {
    return this.prisma as unknown as FaceCardAssetPrismaSlice;
  }

  /** Validate a slug pair, throwing a 400 if anything is off. */
  static parseSlot(rank: string, suit: string): { rank: FaceCardRank; suit: FaceCardSuit } {
    if (!FACE_CARD_RANKS.includes(rank as FaceCardRank)) {
      throw new BadRequestException({
        code: 'FACE_CARD_RANK_INVALID',
        message: `rank must be one of: ${FACE_CARD_RANKS.join(', ')}`,
      });
    }
    if (!FACE_CARD_SUITS.includes(suit as FaceCardSuit)) {
      throw new BadRequestException({
        code: 'FACE_CARD_SUIT_INVALID',
        message: `suit must be one of: ${FACE_CARD_SUITS.join(', ')}`,
      });
    }
    return { rank: rank as FaceCardRank, suit: suit as FaceCardSuit };
  }

  /**
   * Return all 12 slots; uploaded ones have `url`, the rest have `url: null`.
   * The order is stable (rank desc → suit alpha) so the admin grid renders
   * deterministically.
   */
  async list(): Promise<FaceCardAssetDto[]> {
    const rows = await this.slice().faceCardAsset.findMany();
    const byKey = new Map<string, FaceCardAssetRow>();
    for (const row of rows) {
      byKey.set(`${row.rank}:${row.suit}`, row);
    }
    const out: FaceCardAssetDto[] = [];
    for (const rank of FACE_CARD_RANKS) {
      for (const suit of FACE_CARD_SUITS) {
        const row = byKey.get(`${rank}:${suit}`);
        out.push({ rank, suit, url: row?.url ?? null });
      }
    }
    return out;
  }

  async upload(
    rank: FaceCardRank,
    suit: FaceCardSuit,
    uploadedById: string | null,
    input: { buffer: Buffer; mimeType: string | undefined },
  ): Promise<FaceCardAssetDto> {
    if (input.buffer.length > MAX_BYTES) {
      throw new PayloadTooLargeException({
        code: 'FACE_CARD_TOO_LARGE',
        message: `File exceeds ${Math.round(MAX_BYTES / (1024 * 1024))} MB limit`,
      });
    }
    if (!input.mimeType || !ALLOWED_MIME.has(input.mimeType)) {
      throw new BadRequestException({
        code: 'FACE_CARD_INVALID_TYPE',
        message: 'Only JPEG, PNG or WEBP images are allowed',
      });
    }

    let webp: Buffer;
    try {
      webp = await sharp(input.buffer, { failOn: 'error' })
        .rotate()
        .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: 'cover', position: 'centre' })
        .webp({ quality: TARGET_QUALITY })
        .toBuffer();
    } catch (err) {
      this.logger.warn({ err }, 'sharp failed to decode face-card upload');
      throw new BadRequestException({
        code: 'FACE_CARD_INVALID_TYPE',
        message: 'Uploaded file is not a valid image',
      });
    }

    const targetDir = path.join(this.uploadsRoot(), UPLOAD_SUBDIR);
    await fs.mkdir(targetDir, { recursive: true });
    const filename = `${rank}-${suit}.webp`;
    const absolutePath = path.join(targetDir, filename);
    await fs.writeFile(absolutePath, webp);

    // Cache-buster — same trick as the custom card-back, so a re-upload
    // never serves stale bytes from any CDN/browser cache.
    const relativeUrl = `/uploads/${UPLOAD_SUBDIR}/${filename}?v=${Date.now()}`;

    await this.slice().faceCardAsset.upsert({
      where: { rank_suit: { rank, suit } },
      create: { rank, suit, url: relativeUrl, uploadedById },
      update: { url: relativeUrl, uploadedById },
    });

    return { rank, suit, url: relativeUrl };
  }

  /**
   * Remove the custom asset for the (rank, suit) slot. Returns the slot with
   * `url: null` for symmetry with `list()` / `upload()`. Throws 404 if no
   * row existed — the frontend uses that signal to know "nothing to undo".
   */
  async remove(rank: FaceCardRank, suit: FaceCardSuit): Promise<FaceCardAssetDto> {
    const existing = await this.slice().faceCardAsset.findUnique({
      where: { rank_suit: { rank, suit } },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'FACE_CARD_NOT_FOUND',
        message: 'No custom image is set for this slot',
      });
    }
    const target = path.join(this.uploadsRoot(), UPLOAD_SUBDIR, `${rank}-${suit}.webp`);
    try {
      await fs.unlink(target);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        this.logger.warn({ err }, 'Failed to delete face-card asset file');
      }
    }
    await this.slice().faceCardAsset.delete({
      where: { rank_suit: { rank, suit } },
    });
    return { rank, suit, url: null };
  }
}
