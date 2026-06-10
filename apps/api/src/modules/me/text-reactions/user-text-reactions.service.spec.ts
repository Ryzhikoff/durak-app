import { beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { USER_TEXT_REACTION_MAX_PER_USER } from '@durak/shared-types';
import { UserTextReactionsService } from './user-text-reactions.service';

interface FakeRow {
  id: string;
  userId: string;
  text: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

let idCounter = 0;

function makePrismaStub() {
  const rows = new Map<string, FakeRow>();

  return {
    rows,
    userTextReaction: {
      findMany: async ({
        where,
        orderBy,
      }: {
        where: { userId: string };
        orderBy?: Array<{ sortOrder?: 'asc' | 'desc' } | { id?: 'asc' | 'desc' }>;
      }) => {
        let out = Array.from(rows.values()).filter((r) => r.userId === where.userId);
        const wantsSortOrder = (orderBy ?? []).some(
          (o) => 'sortOrder' in o && o.sortOrder === 'asc',
        );
        if (wantsSortOrder) {
          out.sort(
            (a, b) =>
              a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
          );
        }
        return out;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        return rows.get(where.id) ?? null;
      },
      count: async ({ where }: { where: { userId: string } }) => {
        let count = 0;
        for (const r of rows.values()) if (r.userId === where.userId) count++;
        return count;
      },
      create: async ({
        data,
      }: {
        data: { userId: string; text: string; sortOrder: number };
      }) => {
        const id = `utr_${++idCounter}`;
        const now = new Date();
        const row: FakeRow = {
          id,
          userId: data.userId,
          text: data.text,
          sortOrder: data.sortOrder,
          createdAt: now,
          updatedAt: now,
        };
        rows.set(id, row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { text?: string; sortOrder?: number };
      }) => {
        const existing = rows.get(where.id);
        if (!existing) throw new Error('not found');
        const next: FakeRow = {
          ...existing,
          text: data.text ?? existing.text,
          sortOrder: data.sortOrder ?? existing.sortOrder,
          updatedAt: new Date(),
        };
        rows.set(where.id, next);
        return next;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const existing = rows.get(where.id);
        if (!existing) throw new Error('not found');
        rows.delete(where.id);
        return existing;
      },
    },
  };
}

describe('UserTextReactionsService', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let svc: UserTextReactionsService;

  beforeEach(() => {
    idCounter = 0;
    prisma = makePrismaStub();
    svc = new UserTextReactionsService(prisma as never);
  });

  it('create() trims, persists and returns the row', async () => {
    const row = await svc.create('u-1', { text: '  Хороший ход!  ', sortOrder: 5 });
    expect(row.text).toBe('Хороший ход!');
    expect(row.sortOrder).toBe(5);
    expect(row.id).toBeTruthy();
    expect(row.createdAt).toBeTypeOf('string');
  });

  it('create() defaults sortOrder=0 when omitted', async () => {
    const row = await svc.create('u-1', { text: 'GG' });
    expect(row.sortOrder).toBe(0);
  });

  it('create() rejects empty text', async () => {
    await expect(svc.create('u-1', { text: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    try {
      await svc.create('u-1', { text: '' });
    } catch (err) {
      const e = err as BadRequestException;
      expect((e.getResponse() as { code: string }).code).toBe('TEXT_REACTION_EMPTY');
    }
  });

  it('create() rejects >30 chars', async () => {
    try {
      await svc.create('u-1', { text: 'a'.repeat(31) });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const e = err as BadRequestException;
      expect((e.getResponse() as { code: string }).code).toBe('TEXT_REACTION_TOO_LONG');
    }
  });

  it('create() accepts exactly 30 chars', async () => {
    const row = await svc.create('u-1', { text: 'a'.repeat(30) });
    expect(row.text.length).toBe(30);
  });

  it(`create() caps at ${USER_TEXT_REACTION_MAX_PER_USER} rows per user`, async () => {
    for (let i = 0; i < USER_TEXT_REACTION_MAX_PER_USER; i++) {
      await svc.create('u-1', { text: `phrase ${i}` });
    }
    try {
      await svc.create('u-1', { text: 'one too many' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const e = err as BadRequestException;
      expect((e.getResponse() as { code: string }).code).toBe(
        'USER_TEXT_REACTION_LIMIT_REACHED',
      );
    }
    // A different user still has headroom.
    await expect(svc.create('u-2', { text: 'still fine' })).resolves.toBeTruthy();
  });

  it('list() returns rows owned by the given user, sorted (sortOrder ASC, id ASC)', async () => {
    await svc.create('u-1', { text: 'B', sortOrder: 5 });
    await svc.create('u-1', { text: 'A', sortOrder: 1 });
    await svc.create('u-2', { text: 'foreign' });

    const mine = await svc.list('u-1');
    expect(mine.map((r) => r.text)).toEqual(['A', 'B']);
    expect(mine.every((r) => r.id.startsWith('utr_'))).toBe(true);

    const theirs = await svc.list('u-2');
    expect(theirs.map((r) => r.text)).toEqual(['foreign']);
  });

  it('resolveOwn() returns text only when row exists AND user owns it', async () => {
    const mine = await svc.create('u-1', { text: 'mine' });
    const theirs = await svc.create('u-2', { text: 'theirs' });

    expect(await svc.resolveOwn('u-1', mine.id)).toEqual({ id: mine.id, text: 'mine' });
    // Stealing someone else's id must return null — never broadcast.
    expect(await svc.resolveOwn('u-1', theirs.id)).toBeNull();
    expect(await svc.resolveOwn('u-2', mine.id)).toBeNull();
    expect(await svc.resolveOwn('u-1', 'does-not-exist')).toBeNull();
    expect(await svc.resolveOwn('u-1', '')).toBeNull();
    expect(await svc.resolveOwn('', mine.id)).toBeNull();
  });

  it('update() patches text + sortOrder for owner', async () => {
    const created = await svc.create('u-1', { text: 'old', sortOrder: 3 });
    const updated = await svc.update('u-1', created.id, { text: 'new' });
    expect(updated.text).toBe('new');
    expect(updated.sortOrder).toBe(3);
  });

  it('update() validates new text length', async () => {
    const created = await svc.create('u-1', { text: 'ok' });
    await expect(
      svc.update('u-1', created.id, { text: 'a'.repeat(31) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update() throws NotFound for missing id', async () => {
    await expect(svc.update('u-1', 'nope', { text: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('update() refuses to touch another user\'s row (404, not 403, to avoid leaking existence)', async () => {
    const theirs = await svc.create('u-2', { text: 'theirs' });
    try {
      await svc.update('u-1', theirs.id, { text: 'mine now' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundException);
      const e = err as NotFoundException;
      expect((e.getResponse() as { code: string }).code).toBe(
        'USER_TEXT_REACTION_NOT_FOUND',
      );
    }
    // Row should be unchanged.
    const stillTheirs = await svc.list('u-2');
    expect(stillTheirs[0]?.text).toBe('theirs');
  });

  it('remove() deletes the row and reports the id', async () => {
    const created = await svc.create('u-1', { text: 'bye' });
    const out = await svc.remove('u-1', created.id);
    expect(out).toEqual({ id: created.id });
    expect(await svc.list('u-1')).toHaveLength(0);
  });

  it('remove() refuses to delete another user\'s row', async () => {
    const theirs = await svc.create('u-2', { text: 'theirs' });
    await expect(svc.remove('u-1', theirs.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // Row should still be there.
    expect(await svc.list('u-2')).toHaveLength(1);
  });

  it('remove() throws NotFound on missing id', async () => {
    await expect(svc.remove('u-1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
