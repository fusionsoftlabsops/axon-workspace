import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  memoryFindMany: vi.fn(),
  memoryCreate: vi.fn(),
  taskFindUnique: vi.fn(),
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
    brainMemory: { findMany: h.memoryFindMany, create: h.memoryCreate },
    task: { findUnique: h.taskFindUnique },
  },
}));

import { GET, POST } from './route';

const ctx = { params: Promise.resolve({ slug: 'proj' }) };
const authd = { userId: 'u1', tokenId: 't1', scopes: [], projectSlugs: [] as string[] };

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireApiToken.mockResolvedValue({ ...authd });
});

describe('GET memories', () => {
  it('401 auth fails', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(401);
  });
  it('403 not scoped', async () => {
    h.requireApiToken.mockResolvedValue({ ...authd, projectSlugs: ['o'] });
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(403);
  });
  it('404 project missing', async () => {
    h.projectFindUnique.mockResolvedValue(null);
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(404);
  });
  it('200 lists memories (owner, all locals)', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'OWNER' }] });
    h.memoryFindMany.mockResolvedValue([
      {
        id: 'm1', scope: 'PROJECT', type: 'NOTE', title: 'T', body: 'B', tags: [],
        status: 'ACTIVE', author: { name: 'Au' }, ownerUserId: null,
        sourceTask: { taskNumber: 3 }, citationCount: 2, lastCitedAt: new Date('2030-01-01'),
        createdAt: new Date('2030-01-01'), updatedAt: new Date('2030-01-02'),
      },
    ]);
    const res = await GET(new NextRequest('http://localhost/x'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.memories[0]).toMatchObject({ id: 'm1', sourceTaskNumber: 3 });
  });
  it('200 applies scope query + null sourceTask/lastCitedAt (non-owner)', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'MEMBER' }] });
    h.memoryFindMany.mockResolvedValue([
      {
        id: 'm2', scope: 'LOCAL', type: 'NOTE', title: 'T', body: 'B', tags: [],
        status: 'ACTIVE', author: { name: 'Au' }, ownerUserId: 'u1',
        sourceTask: null, citationCount: 0, lastCitedAt: null,
        createdAt: new Date('2030-01-01'), updatedAt: new Date('2030-01-02'),
      },
    ]);
    const res = await GET(new NextRequest('http://localhost/x?scope=LOCAL'), ctx);
    expect(res.status).toBe(200);
    expect(h.memoryFindMany.mock.calls[0][0].where.scope).toBe('LOCAL');
    expect((await res.json()).memories[0].sourceTaskNumber).toBeNull();
  });
});

describe('POST memories', () => {
  function req(body: unknown) {
    return new NextRequest('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  const valid = { type: 'NOTE', title: 'T', body: 'B' };
  it('403 not scoped', async () => {
    h.requireApiToken.mockResolvedValue({ ...authd, projectSlugs: ['o'] });
    expect((await POST(req(valid), ctx)).status).toBe(403);
  });
  it('400 invalid body', async () => {
    expect((await POST(req({ type: 'BAD' }), ctx)).status).toBe(400);
  });
  it('404 project missing', async () => {
    h.projectFindUnique.mockResolvedValue(null);
    expect((await POST(req(valid), ctx)).status).toBe(404);
  });
  it('403 viewer', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'VIEWER' }] });
    expect((await POST(req(valid), ctx)).status).toBe(403);
  });
  it('404 source task missing', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'ADMIN' }] });
    h.taskFindUnique.mockResolvedValue(null);
    expect((await POST(req({ ...valid, sourceTaskNumber: 5 }), ctx)).status).toBe(404);
  });
  it('201 creates LOCAL memory', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'ADMIN' }] });
    h.memoryCreate.mockResolvedValue({ id: 'm1' });
    const res = await POST(req(valid), ctx);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'm1' });
    expect(h.memoryCreate.mock.calls[0][0].data.ownerUserId).toBe('u1');
    expect(h.audit).toHaveBeenCalled();
  });
  it('201 creates PROJECT memory with source task (ownerUserId null)', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'ADMIN' }] });
    h.taskFindUnique.mockResolvedValue({ id: 't1' });
    h.memoryCreate.mockResolvedValue({ id: 'm2' });
    const res = await POST(req({ ...valid, scope: 'PROJECT', sourceTaskNumber: 5 }), ctx);
    expect(res.status).toBe(201);
    expect(h.memoryCreate.mock.calls[0][0].data.ownerUserId).toBeNull();
    expect(h.memoryCreate.mock.calls[0][0].data.sourceTaskId).toBe('t1');
  });
});
