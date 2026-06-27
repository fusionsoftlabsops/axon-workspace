import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  prisma: {
    brainSyncState: { findUnique: vi.fn(), upsert: vi.fn() },
    brainMemory: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => db);

import { pullProjectBrain } from './pull';

const baseOpts = { userId: 'u1', projectId: 'p1', projectSlug: 'AXON' };

function memory(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'm1',
    type: 'DECISION',
    title: 'T',
    body: 'B',
    tags: ['x'],
    status: 'ACTIVE',
    author: { name: 'Ana' },
    sourceTask: { taskNumber: 42 },
    citationCount: 3,
    updatedAt: new Date('2026-02-01T00:00:00Z'),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.prisma.brainSyncState.upsert.mockResolvedValue({});
});

describe('pullProjectBrain', () => {
  it('first pull (no sync state) returns the full active brain and sets lastPulledAt null', async () => {
    db.prisma.brainSyncState.findUnique.mockResolvedValue(null);
    db.prisma.brainMemory.findMany.mockResolvedValue([memory()]);

    const res = await pullProjectBrain(baseOpts);
    expect(res.projectSlug).toBe('AXON');
    expect(res.lastPulledAt).toBeNull();
    expect(res.count).toBe(1);
    expect(res.memories[0]).toMatchObject({
      id: 'm1',
      authorName: 'Ana',
      sourceTaskNumber: 42,
      citationCount: 3,
    });
    // no `since` filter on the first pull
    const whereArg = db.prisma.brainMemory.findMany.mock.calls[0]![0].where;
    expect(whereArg.updatedAt).toBeUndefined();
    expect(db.prisma.brainSyncState.upsert).toHaveBeenCalledTimes(1);
  });

  it('incremental pull applies the `since` filter and echoes lastPulledAt', async () => {
    const since = new Date('2026-01-01T00:00:00Z');
    db.prisma.brainSyncState.findUnique.mockResolvedValue({ lastPulledAt: since });
    db.prisma.brainMemory.findMany.mockResolvedValue([]);

    const res = await pullProjectBrain(baseOpts);
    expect(res.count).toBe(0);
    expect(res.lastPulledAt).toBe(since.toISOString());
    const whereArg = db.prisma.brainMemory.findMany.mock.calls[0]![0].where;
    expect(whereArg.updatedAt).toEqual({ gt: since });
  });

  it('maps a memory with no source task to sourceTaskNumber null', async () => {
    db.prisma.brainSyncState.findUnique.mockResolvedValue(null);
    db.prisma.brainMemory.findMany.mockResolvedValue([memory({ sourceTask: null })]);
    const res = await pullProjectBrain(baseOpts);
    expect(res.memories[0]!.sourceTaskNumber).toBeNull();
  });

  it('clamps the limit into [1, 500]', async () => {
    db.prisma.brainSyncState.findUnique.mockResolvedValue(null);
    db.prisma.brainMemory.findMany.mockResolvedValue([]);

    await pullProjectBrain({ ...baseOpts, limit: 9999 });
    expect(db.prisma.brainMemory.findMany.mock.calls[0]![0].take).toBe(500);

    await pullProjectBrain({ ...baseOpts, limit: 0 });
    expect(db.prisma.brainMemory.findMany.mock.calls[1]![0].take).toBe(1);

    await pullProjectBrain({ ...baseOpts });
    expect(db.prisma.brainMemory.findMany.mock.calls[2]![0].take).toBe(200);
  });
});
