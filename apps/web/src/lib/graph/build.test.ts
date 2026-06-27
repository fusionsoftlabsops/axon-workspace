import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  prisma: {
    sprint: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    taskDependency: { findMany: vi.fn() },
    brainMemory: { findMany: vi.fn() },
    memoryCitation: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => db);

import { buildProjectGraph, focusSubgraph, graphSignature } from './build';

beforeEach(() => {
  vi.clearAllMocks();
});

function seed() {
  db.prisma.sprint.findMany.mockResolvedValue([{ id: 's1', name: 'Sprint 1', order: 0 }]);
  db.prisma.task.findMany.mockResolvedValue([
    {
      id: 't1',
      taskNumber: 1,
      title: 'Parent',
      kind: 'STORY',
      priority: 'HIGH',
      category: 'backend',
      parentTaskId: null,
      sprintId: 's1',
      state: { name: 'Done', category: 'DONE' },
    },
    {
      id: 't2',
      taskNumber: 2,
      title: 'Child',
      kind: 'STORY',
      priority: 'LOW',
      category: null,
      parentTaskId: 't1',
      sprintId: null,
      state: { name: 'Todo', category: 'OPEN' },
    },
  ]);
  db.prisma.taskDependency.findMany.mockResolvedValue([
    { sourceTaskId: 't1', targetTaskId: 't2', kind: 'BLOCKS' },
    { sourceTaskId: 't1', targetTaskId: 'ghost', kind: 'BLOCKS' }, // dangling -> dropped
  ]);
  db.prisma.brainMemory.findMany.mockResolvedValue([
    { id: 'm1', type: 'DECISION', title: 'Use X', citationCount: 2, sourceTaskId: 't1' },
    { id: 'm2', type: 'NOTE', title: 'Orphan', citationCount: 0, sourceTaskId: 'ghost' },
  ]);
  db.prisma.memoryCitation.findMany.mockResolvedValue([
    { memoryId: 'm1', citedInTaskId: 't2' },
    { memoryId: 'mX', citedInTaskId: 't2' }, // unknown memory -> dropped
  ]);
}

describe('buildProjectGraph', () => {
  it('builds nodes and edges from prisma relations', async () => {
    seed();
    const g = await buildProjectGraph('p1');

    const ids = g.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['memory:m1', 'memory:m2', 'sprint:s1', 'task:t1', 'task:t2']);

    const t1 = g.nodes.find((n) => n.id === 'task:t1');
    expect(t1?.done).toBe(true);
    expect(t1?.stateCategory).toBe('DONE');

    const kinds = g.edges.map((e) => `${e.kind}:${e.source}->${e.target}`);
    expect(kinds).toContain('sprint:sprint:s1->task:t1');
    expect(kinds).toContain('subtask:task:t1->task:t2');
    expect(kinds).toContain('dependency:task:t1->task:t2');
    expect(kinds).toContain('source:task:t1->memory:m1');
    expect(kinds).toContain('cites:memory:m1->task:t2');
    // dangling dependency / source / citation are excluded
    expect(kinds.some((k) => k.includes('ghost') || k.includes('mX'))).toBe(false);
  });

  it('returns empty graph when there is nothing', async () => {
    db.prisma.sprint.findMany.mockResolvedValue([]);
    db.prisma.task.findMany.mockResolvedValue([]);
    db.prisma.taskDependency.findMany.mockResolvedValue([]);
    db.prisma.brainMemory.findMany.mockResolvedValue([]);
    db.prisma.memoryCitation.findMany.mockResolvedValue([]);
    const g = await buildProjectGraph('p1');
    expect(g).toEqual({ nodes: [], edges: [] });
  });
});

describe('focusSubgraph', () => {
  it('returns empty when the focus task is absent', async () => {
    seed();
    const g = await buildProjectGraph('p1');
    expect(focusSubgraph(g, 'nope')).toEqual({ nodes: [], edges: [] });
  });

  it('keeps the focus node plus its direct neighbours', async () => {
    seed();
    const g = await buildProjectGraph('p1');
    const sub = focusSubgraph(g, 't2');
    const ids = sub.nodes.map((n) => n.id).sort();
    // t2 + its neighbours: t1 (subtask+dep), m1 (cites)
    expect(ids).toContain('task:t2');
    expect(ids).toContain('task:t1');
    expect(ids).toContain('memory:m1');
    expect(sub.edges.every((e) => e.source === 'task:t2' || e.target === 'task:t2')).toBe(true);
  });
});

describe('graphSignature', () => {
  it('encodes node/edge/done/memory counts', async () => {
    seed();
    const g = await buildProjectGraph('p1');
    expect(graphSignature(g)).toBe('n5-e5-d1-m2');
  });

  it('reflects an empty graph', () => {
    expect(graphSignature({ nodes: [], edges: [] })).toBe('n0-e0-d0-m0');
  });
});
