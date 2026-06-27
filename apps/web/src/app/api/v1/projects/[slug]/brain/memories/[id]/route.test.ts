import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  memoryFindUnique: vi.fn(),
  memoryUpdate: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireApiToken: h.requireApiToken,
  tokenAllowsProject: (a: { projectSlugs: string[] }, s: string) =>
    a.projectSlugs.length === 0 || a.projectSlugs.includes(s),
}));
vi.mock('@/lib/audit', () => ({ audit: h.audit }));
vi.mock('@/lib/db', () => ({
  prisma: { brainMemory: { findUnique: h.memoryFindUnique, update: h.memoryUpdate } },
}));

import { GET, PATCH } from './route';

const ctx = { params: Promise.resolve({ slug: 'proj', id: 'm1' }) };
const authd = { userId: 'u1', tokenId: 't1', scopes: [], projectSlugs: [] as string[] };

function memory(over: Record<string, unknown> = {}) {
  return {
    id: 'm1', scope: 'PROJECT', type: 'NOTE', title: 'T', body: 'B', tags: [],
    status: 'ACTIVE', authorId: 'u1', ownerUserId: null,
    author: { name: 'Au' }, ownerUser: null, sourceTask: { taskNumber: 3 },
    supersededBy: null, supersedes: null, citationCount: 1, lastCitedAt: new Date('2030-01-01'),
    citations: [{
      citedInTask: { taskNumber: 4, title: 'TT' }, citedByUser: { name: 'Cb' },
      context: 'ctx', createdAt: new Date('2030-01-01'),
    }],
    createdAt: new Date('2030-01-01'), updatedAt: new Date('2030-01-02'),
    project: { slug: 'proj', members: [{ role: 'ADMIN', userId: 'u1' }] },
    ...over,
  };
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireApiToken.mockResolvedValue({ ...authd });
});

describe('GET memory by id', () => {
  it('401 auth fails', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(401);
  });
  it('403 not scoped', async () => {
    h.requireApiToken.mockResolvedValue({ ...authd, projectSlugs: ['o'] });
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(403);
  });
  it('404 when memory missing', async () => {
    h.memoryFindUnique.mockResolvedValue(null);
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(404);
  });
  it('404 when slug mismatch', async () => {
    h.memoryFindUnique.mockResolvedValue(memory({ project: { slug: 'other', members: [{ role: 'ADMIN' }] } }));
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(404);
  });
  it('404 LOCAL not owner and not OWNER', async () => {
    h.memoryFindUnique.mockResolvedValue(memory({
      scope: 'LOCAL', ownerUserId: 'other',
      project: { slug: 'proj', members: [{ role: 'MEMBER' }] },
    }));
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(404);
  });
  it('200 returns memory with citations + owner', async () => {
    h.memoryFindUnique.mockResolvedValue(memory({
      ownerUser: { id: 'u9', name: 'Ow' },
    }));
    const res = await GET(new NextRequest('http://localhost/x'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.owner).toEqual({ id: 'u9', name: 'Ow' });
    expect(body.citations[0]).toMatchObject({ taskNumber: 4, citedByName: 'Cb' });
    expect(body.sourceTaskNumber).toBe(3);
  });
  it('200 LOCAL visible to project OWNER, null sourceTask/lastCited', async () => {
    h.memoryFindUnique.mockResolvedValue(memory({
      scope: 'LOCAL', ownerUserId: 'other', sourceTask: null, lastCitedAt: null,
      project: { slug: 'proj', members: [{ role: 'OWNER' }] },
    }));
    const res = await GET(new NextRequest('http://localhost/x'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sourceTaskNumber).toBeNull();
    expect(body.lastCitedAt).toBeNull();
  });
});

describe('PATCH memory', () => {
  function req(body: unknown) {
    return new NextRequest('http://localhost/x', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  it('403 not scoped', async () => {
    h.requireApiToken.mockResolvedValue({ ...authd, projectSlugs: ['o'] });
    expect((await PATCH(req({ title: 'x' }), ctx)).status).toBe(403);
  });
  it('400 invalid body (empty)', async () => {
    expect((await PATCH(req({}), ctx)).status).toBe(400);
  });
  it('404 when memory missing', async () => {
    h.memoryFindUnique.mockResolvedValue(null);
    expect((await PATCH(req({ title: 'x' }), ctx)).status).toBe(404);
  });
  it('403 when not author/owner/admin', async () => {
    h.memoryFindUnique.mockResolvedValue({
      ownerUserId: 'x', authorId: 'x',
      project: { id: 'p1', slug: 'proj', members: [{ role: 'MEMBER' }] },
    });
    expect((await PATCH(req({ title: 'x' }), ctx)).status).toBe(403);
  });
  it('200 updates (deprecate path)', async () => {
    h.memoryFindUnique.mockResolvedValue({
      ownerUserId: 'u1', authorId: 'u1',
      project: { id: 'p1', slug: 'proj', members: [{ role: 'MEMBER' }] },
    });
    const res = await PATCH(req({ status: 'DEPRECATED' }), ctx);
    expect(res.status).toBe(200);
    expect(h.memoryUpdate).toHaveBeenCalled();
    expect(h.audit.mock.calls[0][0].action).toBe('brain.deprecate');
  });
  it('200 updates as project OWNER (non-author)', async () => {
    h.memoryFindUnique.mockResolvedValue({
      ownerUserId: 'x', authorId: 'x',
      project: { id: 'p1', slug: 'proj', members: [{ role: 'OWNER' }] },
    });
    const res = await PATCH(req({ title: 'New' }), ctx);
    expect(res.status).toBe(200);
    expect(h.audit.mock.calls[0][0].action).toBe('brain.capture');
  });
});
