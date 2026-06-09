import { beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminTextReactionsService } from './admin-text-reactions.service';

interface FakeRow {
  id: string;
  text: string;
  sortOrder: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

let idCounter = 0;

function makePrismaStub() {
  const rows = new Map<string, FakeRow>();

  return {
    rows,
    textReaction: {
      findMany: async ({
        where,
        orderBy,
      }: {
        where?: { enabled?: boolean };
        orderBy?: Array<{ sortOrder?: 'asc' | 'desc' } | { id?: 'asc' | 'desc' }>;
      }) => {
        let out = Array.from(rows.values());
        if (where?.enabled !== undefined) {
          out = out.filter((r) => r.enabled === where.enabled);
        }
        // Stable sort by sortOrder ASC, then id ASC (mirrors the production
        // call site's `[sortOrder, id]` order tuple).
        const wantsSortOrder = (orderBy ?? []).some(
          (o) => 'sortOrder' in o && o.sortOrder === 'asc',
        );
        if (wantsSortOrder) {
          out.sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        }
        return out;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        return rows.get(where.id) ?? null;
      },
      create: async ({
        data,
      }: {
        data: { text: string; sortOrder: number; enabled: boolean };
      }) => {
        const id = `tr_${++idCounter}`;
        const now = new Date();
        const row: FakeRow = {
          id,
          text: data.text,
          sortOrder: data.sortOrder,
          enabled: data.enabled,
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
        data: { text?: string; sortOrder?: number; enabled?: boolean };
      }) => {
        const existing = rows.get(where.id);
        if (!existing) throw new Error('not found');
        const next: FakeRow = {
          ...existing,
          text: data.text ?? existing.text,
          sortOrder: data.sortOrder ?? existing.sortOrder,
          enabled: data.enabled ?? existing.enabled,
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

describe('AdminTextReactionsService', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let svc: AdminTextReactionsService;

  beforeEach(() => {
    idCounter = 0;
    prisma = makePrismaStub();
    svc = new AdminTextReactionsService(prisma as never);
  });

  it('create() trims, persists and returns the row', async () => {
    const row = await svc.create({ text: '  Привет!  ', sortOrder: 5 });
    expect(row.text).toBe('Привет!');
    expect(row.sortOrder).toBe(5);
    expect(row.enabled).toBe(true);
    expect(row.id).toBeTruthy();
  });

  it('create() defaults sortOrder=0 and enabled=true when omitted', async () => {
    const row = await svc.create({ text: 'Хороший ход' });
    expect(row.sortOrder).toBe(0);
    expect(row.enabled).toBe(true);
  });

  it('create() rejects empty text with TEXT_REACTION_EMPTY', async () => {
    await expect(svc.create({ text: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    try {
      await svc.create({ text: '' });
    } catch (err) {
      const e = err as BadRequestException;
      expect((e.getResponse() as { code: string }).code).toBe('TEXT_REACTION_EMPTY');
    }
  });

  it('create() rejects >30 chars with TEXT_REACTION_TOO_LONG', async () => {
    const long = 'a'.repeat(31);
    try {
      await svc.create({ text: long });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const e = err as BadRequestException;
      expect((e.getResponse() as { code: string }).code).toBe('TEXT_REACTION_TOO_LONG');
    }
  });

  it('create() accepts exactly 30 chars', async () => {
    const ok = 'a'.repeat(30);
    const row = await svc.create({ text: ok });
    expect(row.text).toBe(ok);
  });

  it('list() returns rows sorted by (sortOrder ASC, id ASC) and includes disabled', async () => {
    await svc.create({ text: 'B', sortOrder: 5 });
    await svc.create({ text: 'A', sortOrder: 1 });
    const disabled = await svc.create({ text: 'C', sortOrder: 2, enabled: false });

    const all = await svc.list();
    expect(all.map((r) => r.text)).toEqual(['A', 'C', 'B']);
    expect(all.find((r) => r.id === disabled.id)?.enabled).toBe(false);
  });

  it('listEnabled() filters out disabled rows and strips admin metadata', async () => {
    await svc.create({ text: 'visible', sortOrder: 0 });
    await svc.create({ text: 'hidden', sortOrder: 1, enabled: false });

    const enabled = await svc.listEnabled();
    expect(enabled.map((r) => r.text)).toEqual(['visible']);
    expect(enabled[0]).toEqual(
      expect.objectContaining({ text: 'visible', sortOrder: 0 }),
    );
    expect((enabled[0] as unknown as Record<string, unknown>).enabled).toBeUndefined();
  });

  it('resolveEnabled() returns null for missing / disabled rows', async () => {
    const ok = await svc.create({ text: 'live' });
    const off = await svc.create({ text: 'off', enabled: false });

    expect(await svc.resolveEnabled(ok.id)).toEqual({
      id: ok.id,
      text: 'live',
      sortOrder: 0,
    });
    expect(await svc.resolveEnabled(off.id)).toBeNull();
    expect(await svc.resolveEnabled('does-not-exist')).toBeNull();
    expect(await svc.resolveEnabled('')).toBeNull();
  });

  it('update() patches only provided fields and bumps updatedAt', async () => {
    const created = await svc.create({ text: 'old', sortOrder: 3, enabled: true });
    const updated = await svc.update(created.id, { text: 'new', enabled: false });

    expect(updated.text).toBe('new');
    expect(updated.enabled).toBe(false);
    // sortOrder is untouched.
    expect(updated.sortOrder).toBe(3);
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updatedAt).getTime(),
    );
  });

  it('update() validates the new text length', async () => {
    const created = await svc.create({ text: 'ok' });
    await expect(svc.update(created.id, { text: 'a'.repeat(31) })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('update() throws TEXT_REACTION_NOT_FOUND when id missing', async () => {
    await expect(svc.update('nope', { text: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove() deletes the row and reports the id', async () => {
    const created = await svc.create({ text: 'bye' });
    const out = await svc.remove(created.id);
    expect(out).toEqual({ id: created.id });
    expect(await svc.list()).toHaveLength(0);
  });

  it('remove() throws TEXT_REACTION_NOT_FOUND on a missing id', async () => {
    await expect(svc.remove('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
