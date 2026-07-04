import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  memberFindMany: vi.fn(),
  taskGroupBy: vi.fn(),
  draftGroupBy: vi.fn(),
  agentGroupBy: vi.fn(),
  runGroupBy: vi.fn(),
  agentFindMany: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ requireApiToken: h.requireApiToken }));
vi.mock('@/lib/db', () => ({
  prisma: {
    projectMember: { findMany: h.memberFindMany },
    task: { groupBy: h.taskGroupBy },
    storyDraft: { groupBy: h.draftGroupBy },
    agent: { groupBy: h.agentGroupBy, findMany: h.agentFindMany },
    agentRun: { groupBy: h.runGroupBy },
  },
}));

import { GET } from './route';

const req = () => new NextRequest('http://localhost/api/v1/projects');

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireApiToken.mockResolvedValue({ userId: 'u1', scopes: [], projectSlugs: [] });
  h.memberFindMany.mockResolvedValue([
    { role: 'OWNER', project: { id: 'p1', slug: 'axon', name: 'Axon', teamPreset: 'MAX', devExecutor: 'HYBRID', updatedAt: new Date('2026-07-04') } },
    { role: 'MEMBER', project: { id: 'p2', slug: 'forgeia', name: 'Forge', teamPreset: null, devExecutor: 'KAI', updatedAt: new Date('2026-07-03') } },
  ]);
  h.taskGroupBy.mockResolvedValue([{ projectId: 'p1', _count: { _all: 5 } }]);
  h.draftGroupBy.mockResolvedValue([{ projectId: 'p2', _count: { _all: 2 } }]);
  h.agentGroupBy.mockResolvedValue([{ projectId: 'p1', _count: { _all: 9 } }]);
  h.runGroupBy.mockResolvedValue([{ agentId: 'ag1', _count: { _all: 1 } }]);
  h.agentFindMany.mockResolvedValue([{ id: 'ag1', projectId: 'p1' }]);
});

describe('GET /api/v1/projects', () => {
  it('401 cuando el token falla', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await GET(req())).status).toBe(401);
  });

  it('lista los proyectos del usuario con rollup de counts', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toHaveLength(2);
    const axon = body.projects.find((p: { slug: string }) => p.slug === 'axon');
    expect(axon).toMatchObject({
      role: 'OWNER',
      teamPreset: 'MAX',
      devExecutor: 'HYBRID',
      counts: { openTasks: 5, drafts: 0, agentsEnabled: 9, runningRuns: 1 },
    });
    const forge = body.projects.find((p: { slug: string }) => p.slug === 'forgeia');
    expect(forge.counts).toMatchObject({ openTasks: 0, drafts: 2, agentsEnabled: 0, runningRuns: 0 });
  });

  it('respeta el allowlist de projectSlugs del token', async () => {
    h.requireApiToken.mockResolvedValue({ userId: 'u1', scopes: [], projectSlugs: ['axon'] });
    const res = await GET(req());
    const body = await res.json();
    expect(body.projects.map((p: { slug: string }) => p.slug)).toEqual(['axon']);
  });

  it('devuelve lista vacía sin membresías', async () => {
    h.memberFindMany.mockResolvedValue([]);
    const body = await (await GET(req())).json();
    expect(body.projects).toEqual([]);
  });
});
