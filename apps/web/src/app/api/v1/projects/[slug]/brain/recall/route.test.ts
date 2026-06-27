import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  searchBrain: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireApiToken: h.requireApiToken,
  tokenAllowsProject: (a: { projectSlugs: string[] }, s: string) =>
    a.projectSlugs.length === 0 || a.projectSlugs.includes(s),
}));
vi.mock('@/lib/brain', () => ({ searchBrain: h.searchBrain }));
vi.mock('@/lib/db', () => ({ prisma: { project: { findUnique: h.projectFindUnique } } }));

import { GET } from './route';

const ctx = { params: Promise.resolve({ slug: 'proj' }) };
const authd = { userId: 'u1', tokenId: 't1', scopes: [], projectSlugs: [] as string[] };

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireApiToken.mockResolvedValue({ ...authd });
});

describe('GET brain/recall', () => {
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
  it('200 searches with query + limit (owner)', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'OWNER' }] });
    h.searchBrain.mockResolvedValue([
      {
        id: 'm1', scope: 'PROJECT', type: 'NOTE', title: 'T', body: 'B', tags: [],
        status: 'ACTIVE', authorName: 'Au', sourceTaskNumber: 3, citationCount: 1,
        lastCitedAt: new Date('2030-01-01'), updatedAt: new Date('2030-01-02'), rank: 0.5,
      },
    ]);
    const res = await GET(new NextRequest('http://localhost/x?q=hello&limit=5'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.query).toBe('hello');
    expect(body.count).toBe(1);
    expect(h.searchBrain.mock.calls[0][0]).toMatchObject({ includeAllLocals: true, query: 'hello', limit: 5 });
  });
  it('200 with no query, clamps invalid limit to default, null lastCited', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'MEMBER' }] });
    h.searchBrain.mockResolvedValue([
      {
        id: 'm2', scope: 'LOCAL', type: 'NOTE', title: 'T', body: 'B', tags: [],
        status: 'ACTIVE', authorName: 'Au', sourceTaskNumber: null, citationCount: 0,
        lastCitedAt: null, updatedAt: new Date('2030-01-02'), rank: 0,
      },
    ]);
    const res = await GET(new NextRequest('http://localhost/x?limit=abc'), ctx);
    const body = await res.json();
    expect(body.query).toBeNull();
    expect(body.memories[0].lastCitedAt).toBeNull();
    expect(h.searchBrain.mock.calls[0][0]).toMatchObject({ includeAllLocals: false, query: undefined, limit: 20 });
  });
});
