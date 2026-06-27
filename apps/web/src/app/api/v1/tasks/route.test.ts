import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { requireApiToken, findMany } = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  findMany: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireApiToken,
  tokenAllowsProject: (auth: { projectSlugs: string[] }, slug: string) =>
    auth.projectSlugs.length === 0 || auth.projectSlugs.includes(slug),
}));
vi.mock('@/lib/db', () => ({ prisma: { task: { findMany } } }));

import { GET } from './route';

const authd = { userId: 'u1', tokenId: 't1', scopes: ['tasks:read'], projectSlugs: [] as string[] };

function sampleTask(over: Record<string, unknown> = {}) {
  return {
    id: 'task1',
    taskNumber: 5,
    title: 'T',
    priority: 'HIGH',
    dueDate: new Date('2030-01-01T00:00:00Z'),
    updatedAt: new Date('2030-01-02T00:00:00Z'),
    project: { slug: 'proj', name: 'Proj' },
    state: { name: 'Todo', category: 'TODO' },
    assignee: { id: 'a1', name: 'Ana' },
    ...over,
  };
}

beforeEach(() => {
  requireApiToken.mockReset();
  findMany.mockReset();
  requireApiToken.mockResolvedValue({ ...authd });
});

describe('GET /api/v1/tasks', () => {
  it('returns 401 when auth fails', async () => {
    requireApiToken.mockResolvedValue(NextResponse.json({ error: 'x' }, { status: 401 }));
    const res = await GET(new NextRequest('http://localhost/api/v1/tasks'));
    expect(res.status).toBe(401);
  });

  it('rejects a project not allowed by token scope (403)', async () => {
    requireApiToken.mockResolvedValue({ ...authd, projectSlugs: ['other'] });
    const res = await GET(new NextRequest('http://localhost/api/v1/tasks?project=proj'));
    expect(res.status).toBe(403);
  });

  it('lists tasks with no project filter (unrestricted token)', async () => {
    findMany.mockResolvedValue([sampleTask()]);
    const res = await GET(new NextRequest('http://localhost/api/v1/tasks'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks[0]).toMatchObject({
      number: 5,
      project: 'proj',
      assignee: { id: 'a1', name: 'Ana' },
    });
    expect(body.tasks[0].dueDate).toBe('2030-01-01T00:00:00.000Z');
  });

  it('applies project/assignedToMe/state filters and maps null assignee+dueDate', async () => {
    requireApiToken.mockResolvedValue({ ...authd, projectSlugs: ['proj'] });
    findMany.mockResolvedValue([sampleTask({ assignee: null, dueDate: null })]);
    const res = await GET(
      new NextRequest('http://localhost/api/v1/tasks?project=proj&assignedToMe=true&state=Todo'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks[0].assignee).toBeNull();
    expect(body.tasks[0].dueDate).toBeNull();
    const where = findMany.mock.calls[0][0].where;
    expect(where.assigneeId).toBe('u1');
    expect(where.state).toEqual({ name: 'Todo' });
  });

  it('filters by the token project slugs when none requested', async () => {
    requireApiToken.mockResolvedValue({ ...authd, projectSlugs: ['proj'] });
    findMany.mockResolvedValue([]);
    await GET(new NextRequest('http://localhost/api/v1/tasks'));
    const where = findMany.mock.calls[0][0].where;
    expect(where.project.slug).toEqual({ in: ['proj'] });
  });
});
