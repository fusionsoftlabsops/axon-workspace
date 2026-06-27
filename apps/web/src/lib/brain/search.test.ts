import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ prisma: { $queryRaw: vi.fn() } }));
vi.mock('@/lib/db', () => db);

import { searchBrain, isStale } from './search';

/** Pull the flat list of interpolated parameter values from the captured Sql. */
function lastValues(): unknown[] {
  const arg = db.prisma.$queryRaw.mock.calls.at(-1)![0] as { values: unknown[] };
  return arg.values;
}
function lastText(): string {
  const arg = db.prisma.$queryRaw.mock.calls.at(-1)![0] as { sql?: string; text?: string };
  return (arg.sql ?? arg.text ?? '') as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.prisma.$queryRaw.mockResolvedValue([{ id: 'm1' }]);
});

describe('searchBrain', () => {
  const base = { projectId: 'p1', requesterUserId: 'u1' };

  it('runs a default search (own LOCAL + PROJECT, ACTIVE) and returns rows', async () => {
    const rows = await searchBrain(base);
    expect(rows).toEqual([{ id: 'm1' }]);
    const vals = lastValues();
    expect(vals).toContain('p1');
    expect(vals).toContain('u1'); // ownerUserId guard for own LOCAL
    const text = lastText();
    expect(text).toContain('NULL::float4'); // no query -> null rank
  });

  it('includes all LOCAL memories for OWNER view', async () => {
    await searchBrain({ ...base, includeAllLocals: true });
    const text = lastText();
    expect(text).toContain("m.scope = 'LOCAL'");
  });

  it('adds a full-text predicate and rank ordering when a query is given', async () => {
    await searchBrain({ ...base, query: 'postgres' });
    const vals = lastValues();
    expect(vals).toContain('postgres');
    expect(lastText()).toContain('plainto_tsquery');
  });

  it('ignores a blank query', async () => {
    await searchBrain({ ...base, query: '   ' });
    expect(lastText()).toContain('NULL::float4');
  });

  it('applies every optional filter branch', async () => {
    await searchBrain({
      ...base,
      filters: {
        scope: ['PROJECT', 'LOCAL'],
        type: ['DECISION'],
        tags: ['db', 'infra'],
        authorId: 'a1',
        status: ['ARCHIVED'],
        orphansOnly: true,
        staleOnly: true,
      },
    });
    const vals = lastValues();
    expect(vals).toContain('a1');
    const text = lastText();
    expect(text).toContain('citationCount" = 0');
    expect(text).toContain('lastCitedAt');
  });

  it('takes the includeStale=false default branch (no stale filter)', async () => {
    await searchBrain({ ...base, filters: { includeStale: false } });
    expect(db.prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('clamps the limit into [1, 200]', async () => {
    await searchBrain({ ...base, limit: 9999 });
    expect(lastValues()).toContain(200);
    await searchBrain({ ...base, limit: -5 });
    expect(lastValues()).toContain(1);
  });
});

describe('isStale', () => {
  const now = Date.now();
  const sevenMonths = 1000 * 60 * 60 * 24 * 30 * 7;
  const oneMonth = 1000 * 60 * 60 * 24 * 30;

  it('uses lastCitedAt when present', () => {
    expect(isStale({ lastCitedAt: new Date(now - sevenMonths), updatedAt: new Date(now) })).toBe(
      true,
    );
    expect(isStale({ lastCitedAt: new Date(now - oneMonth), updatedAt: new Date(0) })).toBe(false);
  });

  it('falls back to updatedAt when never cited', () => {
    expect(isStale({ lastCitedAt: null, updatedAt: new Date(now - sevenMonths) })).toBe(true);
    expect(isStale({ lastCitedAt: null, updatedAt: new Date(now - oneMonth) })).toBe(false);
  });
});
