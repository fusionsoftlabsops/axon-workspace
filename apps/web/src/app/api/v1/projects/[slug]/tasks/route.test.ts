import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  taskFindMany: vi.fn(),
  taskFindUnique: vi.fn(),
  transaction: vi.fn(),
  counterUpdate: vi.fn(),
  taskAggregate: vi.fn(),
  taskCreate: vi.fn(),
  activityCreate: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireApiToken: h.requireApiToken,
  tokenAllowsProject: (a: { projectSlugs: string[] }, s: string) =>
    a.projectSlugs.length === 0 || a.projectSlugs.includes(s),
}));
vi.mock('@/lib/audit', () => ({ audit: h.audit }));
vi.mock('@/lib/db', () => ({
  prisma: {
    project: { findUnique: h.projectFindUnique },
    task: { findMany: h.taskFindMany, findUnique: h.taskFindUnique, aggregate: h.taskAggregate, create: h.taskCreate },
    projectTaskCounter: { update: h.counterUpdate },
    taskActivity: { create: h.activityCreate },
    $transaction: h.transaction,
  },
}));

import { GET, POST } from './route';

const ctx = { params: Promise.resolve({ slug: 'proj' }) };
const authd = { userId: 'u1', tokenId: 't1', scopes: [], projectSlugs: [] as string[] };

function project(role = 'ADMIN') {
  return {
    id: 'p1',
    slug: 'proj',
    members: [{ role }],
    workflows: [{ states: [{ id: 's1', name: 'Todo', category: 'TODO', order: 0 }] }],
  };
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireApiToken.mockResolvedValue({ ...authd });
  h.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      projectTaskCounter: { update: h.counterUpdate },
      task: { aggregate: h.taskAggregate, create: h.taskCreate },
      taskActivity: { create: h.activityCreate },
    }),
  );
});

describe('GET /api/v1/projects/[slug]/tasks', () => {
  it('401 when auth fails', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    const res = await GET(new NextRequest('http://localhost/x'), ctx);
    expect(res.status).toBe(401);
  });

  it('403 when token not scoped', async () => {
    h.requireApiToken.mockResolvedValue({ ...authd, projectSlugs: ['other'] });
    const res = await GET(new NextRequest('http://localhost/x'), ctx);
    expect(res.status).toBe(403);
  });

  it('404 when project missing or not a member', async () => {
    h.projectFindUnique.mockResolvedValue(null);
    const res = await GET(new NextRequest('http://localhost/x'), ctx);
    expect(res.status).toBe(404);
  });

  it('lists tasks (incluye updatedAt para el sweep del SM)', async () => {
    h.projectFindUnique.mockResolvedValue(project());
    h.taskFindMany.mockResolvedValue([
      {
        id: 't1', taskNumber: 1, title: 'A', priority: 'LOW',
        dueDate: null, state: { name: 'Todo', category: 'TODO' }, assignee: null,
        updatedAt: new Date('2026-07-03T10:00:00Z'),
      },
    ]);
    const res = await GET(new NextRequest('http://localhost/x'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks[0]).toMatchObject({
      number: 1,
      assignee: null,
      dueDate: null,
      updatedAt: '2026-07-03T10:00:00.000Z',
    });
  });
});

describe('POST /api/v1/projects/[slug]/tasks', () => {
  function req(body: unknown) {
    return new NextRequest('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('403 not scoped', async () => {
    h.requireApiToken.mockResolvedValue({ ...authd, projectSlugs: ['other'] });
    const res = await POST(req({ title: 'x' }), ctx);
    expect(res.status).toBe(403);
  });

  it('404 project missing', async () => {
    h.projectFindUnique.mockResolvedValue(null);
    const res = await POST(req({ title: 'x' }), ctx);
    expect(res.status).toBe(404);
  });

  it('403 when viewer', async () => {
    h.projectFindUnique.mockResolvedValue(project('VIEWER'));
    const res = await POST(req({ title: 'x' }), ctx);
    expect(res.status).toBe(403);
  });

  it('400 invalid body', async () => {
    h.projectFindUnique.mockResolvedValue(project());
    const res = await POST(req({ title: '' }), ctx);
    expect(res.status).toBe(400);
  });

  it('500 when no default workflow', async () => {
    h.projectFindUnique.mockResolvedValue({ ...project(), workflows: [] });
    const res = await POST(req({ title: 'x' }), ctx);
    expect(res.status).toBe(500);
  });

  it('400 when named state not found', async () => {
    h.projectFindUnique.mockResolvedValue(project());
    const res = await POST(req({ title: 'x', stateName: 'Nope' }), ctx);
    expect(res.status).toBe(400);
  });

  it('400 when parent task not found', async () => {
    h.projectFindUnique.mockResolvedValue(project());
    h.taskFindUnique.mockResolvedValue(null);
    const res = await POST(req({ title: 'x', parentTaskNumber: 9 }), ctx);
    expect(res.status).toBe(400);
  });

  it('201 creates a task with parent + named state', async () => {
    h.projectFindUnique.mockResolvedValue(project());
    h.taskFindUnique.mockResolvedValue({ id: 'parent1' });
    h.counterUpdate.mockResolvedValue({ next: 6 });
    h.taskAggregate.mockResolvedValue({ _max: { positionInState: null } });
    h.taskCreate.mockResolvedValue({ id: 'new1', taskNumber: 5, title: 'x' });
    const res = await POST(req({ title: 'x', stateName: 'todo', parentTaskNumber: 3 }), ctx);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ id: 'new1', number: 5, project: 'proj', state: 'Todo' });
    expect(h.audit).toHaveBeenCalled();
  });
});
