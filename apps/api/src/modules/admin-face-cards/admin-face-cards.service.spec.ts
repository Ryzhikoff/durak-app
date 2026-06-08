import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { AdminFaceCardsService } from './admin-face-cards.service';

interface FakeRow {
  rank: string;
  suit: string;
  url: string;
  uploadedById: string | null;
}

function makePrismaStub() {
  const rows = new Map<string, FakeRow>();
  const key = (rank: string, suit: string) => `${rank}:${suit}`;
  return {
    rows,
    faceCardAsset: {
      findMany: vi.fn(async () => Array.from(rows.values())),
      findUnique: vi.fn(async ({ where }: { where: { rank_suit: { rank: string; suit: string } } }) => {
        return rows.get(key(where.rank_suit.rank, where.rank_suit.suit)) ?? null;
      }),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { rank_suit: { rank: string; suit: string } };
          create: FakeRow;
          update: { url: string; uploadedById: string | null };
        }) => {
          const k = key(where.rank_suit.rank, where.rank_suit.suit);
          const existing = rows.get(k);
          const next: FakeRow = existing
            ? { ...existing, url: update.url, uploadedById: update.uploadedById }
            : { rank: create.rank, suit: create.suit, url: create.url, uploadedById: create.uploadedById };
          rows.set(k, next);
          return next;
        },
      ),
      delete: vi.fn(async ({ where }: { where: { rank_suit: { rank: string; suit: string } } }) => {
        const k = key(where.rank_suit.rank, where.rank_suit.suit);
        const existing = rows.get(k);
        if (!existing) throw new Error('not found');
        rows.delete(k);
        return existing;
      }),
    },
  };
}

function makeConfig(uploadsDir: string): ConfigService {
  return {
    get: (key: string) => (key === 'UPLOADS_DIR' ? uploadsDir : undefined),
  } as unknown as ConfigService;
}

/**
 * Build a valid 10×10 PNG buffer via sharp — enough that the upload pipeline
 * can decode and re-encode it without producing a real image fixture file.
 */
async function makePngBuffer(): Promise<Buffer> {
  return sharp({
    create: {
      width: 10,
      height: 10,
      channels: 3,
      background: { r: 200, g: 50, b: 50 },
    },
  })
    .png()
    .toBuffer();
}

describe('AdminFaceCardsService', () => {
  let uploadsDir: string;

  beforeEach(async () => {
    uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'face-cards-test-'));
  });

  afterEach(async () => {
    await fs.rm(uploadsDir, { recursive: true, force: true });
  });

  it('list() returns 12 slots, all null when no rows exist', async () => {
    const prisma = makePrismaStub();
    const svc = new AdminFaceCardsService(prisma as never, makeConfig(uploadsDir));
    const out = await svc.list();
    expect(out).toHaveLength(12);
    expect(out.every((s) => s.url === null)).toBe(true);
    // Slots cover all (rank, suit) pairs.
    const keys = out.map((s) => `${s.rank}:${s.suit}`);
    expect(new Set(keys).size).toBe(12);
  });

  it('list() exposes uploaded url for matching rows', async () => {
    const prisma = makePrismaStub();
    prisma.rows.set('jack:spades', {
      rank: 'jack',
      suit: 'spades',
      url: '/uploads/face-cards/jack-spades.webp?v=1',
      uploadedById: 'admin',
    });
    const svc = new AdminFaceCardsService(prisma as never, makeConfig(uploadsDir));
    const out = await svc.list();
    const slot = out.find((s) => s.rank === 'jack' && s.suit === 'spades');
    expect(slot?.url).toContain('/uploads/face-cards/jack-spades.webp');
  });

  it('upload() writes a webp file, upserts the row, and returns the new url', async () => {
    const prisma = makePrismaStub();
    const svc = new AdminFaceCardsService(prisma as never, makeConfig(uploadsDir));
    const buffer = await makePngBuffer();
    const result = await svc.upload('queen', 'hearts', 'admin-1', {
      buffer,
      mimeType: 'image/png',
    });
    expect(result.rank).toBe('queen');
    expect(result.suit).toBe('hearts');
    expect(result.url).toMatch(/^\/uploads\/face-cards\/queen-hearts\.webp\?v=\d+$/);
    expect(prisma.faceCardAsset.upsert).toHaveBeenCalledOnce();
    const stat = await fs.stat(path.join(uploadsDir, 'face-cards', 'queen-hearts.webp'));
    expect(stat.size).toBeGreaterThan(0);
  });

  it('upload() overwrites an existing slot', async () => {
    const prisma = makePrismaStub();
    const svc = new AdminFaceCardsService(prisma as never, makeConfig(uploadsDir));
    const buffer = await makePngBuffer();
    const first = await svc.upload('king', 'clubs', 'a1', { buffer, mimeType: 'image/png' });
    const second = await svc.upload('king', 'clubs', 'a2', { buffer, mimeType: 'image/png' });
    expect(prisma.faceCardAsset.upsert).toHaveBeenCalledTimes(2);
    // Cache-busting suffix differs so URLs aren't identical bytes.
    expect(first.url).not.toBe(second.url);
    expect(second.url).toMatch(/king-clubs\.webp/);
  });

  it('upload() rejects unsupported mime types with FACE_CARD_INVALID_TYPE', async () => {
    const prisma = makePrismaStub();
    const svc = new AdminFaceCardsService(prisma as never, makeConfig(uploadsDir));
    const buffer = Buffer.from('not an image');
    await expect(
      svc.upload('jack', 'spades', null, { buffer, mimeType: 'application/octet-stream' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    try {
      await svc.upload('jack', 'spades', null, { buffer, mimeType: 'application/octet-stream' });
    } catch (err) {
      const e = err as BadRequestException;
      expect((e.getResponse() as { code: string }).code).toBe('FACE_CARD_INVALID_TYPE');
    }
    expect(prisma.faceCardAsset.upsert).not.toHaveBeenCalled();
  });

  it('upload() rejects oversized payloads with FACE_CARD_TOO_LARGE', async () => {
    const prisma = makePrismaStub();
    const svc = new AdminFaceCardsService(prisma as never, makeConfig(uploadsDir));
    const buffer = Buffer.alloc(6 * 1024 * 1024); // 6 MB > 5 MB cap
    await expect(
      svc.upload('queen', 'diamonds', null, { buffer, mimeType: 'image/png' }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('upload() rejects non-image buffers even when mime claims JPEG', async () => {
    const prisma = makePrismaStub();
    const svc = new AdminFaceCardsService(prisma as never, makeConfig(uploadsDir));
    const buffer = Buffer.from('totally not a jpeg');
    await expect(
      svc.upload('jack', 'hearts', null, { buffer, mimeType: 'image/jpeg' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('remove() deletes the file and the row when the slot is set', async () => {
    const prisma = makePrismaStub();
    const svc = new AdminFaceCardsService(prisma as never, makeConfig(uploadsDir));
    const buffer = await makePngBuffer();
    await svc.upload('queen', 'spades', null, { buffer, mimeType: 'image/png' });
    const removed = await svc.remove('queen', 'spades');
    expect(removed.url).toBeNull();
    expect(prisma.faceCardAsset.delete).toHaveBeenCalledOnce();
    await expect(
      fs.stat(path.join(uploadsDir, 'face-cards', 'queen-spades.webp')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('remove() throws FACE_CARD_NOT_FOUND when nothing is set', async () => {
    const prisma = makePrismaStub();
    const svc = new AdminFaceCardsService(prisma as never, makeConfig(uploadsDir));
    await expect(svc.remove('jack', 'spades')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.faceCardAsset.delete).not.toHaveBeenCalled();
  });

  it('parseSlot() rejects unknown rank/suit values', () => {
    expect(() => AdminFaceCardsService.parseSlot('ace', 'spades')).toThrow(BadRequestException);
    expect(() => AdminFaceCardsService.parseSlot('jack', 'crowns')).toThrow(BadRequestException);
    expect(AdminFaceCardsService.parseSlot('king', 'clubs')).toEqual({
      rank: 'king',
      suit: 'clubs',
    });
  });
});
