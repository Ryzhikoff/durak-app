import { describe, it, expect } from 'vitest';
import { CardBacksService } from './card-backs.service';

describe('CardBacksService', () => {
  const svc = new CardBacksService();

  it('returns a non-empty list of card-back definitions', () => {
    const res = svc.list();
    expect(res.items.length).toBeGreaterThanOrEqual(10);
    expect(res.randomOptionId).toBe('__random__');
  });

  it('each item has stable required fields', () => {
    const { items } = svc.list();
    for (const cb of items) {
      expect(typeof cb.id).toBe('string');
      expect(cb.id.length).toBeGreaterThan(0);
      expect(typeof cb.name).toBe('string');
      expect(cb.kind).toBe('pattern');
      expect(Array.isArray(cb.colors)).toBe(true);
      expect(cb.colors).toHaveLength(2);
      expect(cb.colors[0]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(cb.colors[1]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(['dots', 'grid', 'stripes', 'crosshatch', 'chevron', 'wave', 'plain']).toContain(
        cb.pattern,
      );
    }
  });

  it('ids are unique', () => {
    const ids = svc.list().items.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('contains the default classic-1 referenced by Prisma schema default', () => {
    expect(svc.find('classic-1')).toBeDefined();
  });
});
