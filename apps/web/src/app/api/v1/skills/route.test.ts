import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireApiToken: h.requireApiToken,
  tokenAllowsProject: () => true,
}));
vi.mock('@/lib/audit', () => ({ audit: h.audit }));
vi.mock('@/lib/db', () => ({
  prisma: { skill: { findMany: h.findMany, findUnique: h.findUnique, create: h.create } },
}));

import { GET, POST } from './route';

const authd = { userId: 'u1', tokenId: 't1', scopes: [], projectSlugs: [] as string[] };
function req(url: string, body?: unknown) {
  return new NextRequest(url, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireApiToken.mockResolvedValue({ ...authd });
});

describe('GET /api/v1/skills', () => {
  it('401 when auth fails', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await GET(req('http://x/api/v1/skills'))).status).toBe(401);
  });

  it('returns approved skills; passes a valid category filter', async () => {
    h.findMany.mockResolvedValue([
      { slug: 'cerrar-hu', name: 'Cerrar HU', description: 'd', category: 'WORKFLOW', kind: 'COMMAND', body: 'b', official: true, version: 1, tags: [], updatedAt: new Date() },
    ]);
    const res = await GET(req('http://x/api/v1/skills?category=WORKFLOW'));
    expect(res.status).toBe(200);
    expect((await res.json()).skills[0].slug).toBe('cerrar-hu');
    expect(h.findMany.mock.calls[0]![0].where).toEqual({ status: 'APPROVED', category: 'WORKFLOW' });
  });

  it('ignores an invalid category', async () => {
    h.findMany.mockResolvedValue([]);
    await GET(req('http://x/api/v1/skills?category=NOPE'));
    expect(h.findMany.mock.calls[0]![0].where).toEqual({ status: 'APPROVED' });
  });
});

describe('POST /api/v1/skills', () => {
  it('400 on invalid body', async () => {
    const res = await POST(req('http://x/api/v1/skills', { slug: 'Bad Slug', name: 'n', description: 'desc', body: 'b' }));
    expect(res.status).toBe(400);
  });

  it('409 on duplicate slug', async () => {
    h.findUnique.mockResolvedValue({ id: 'exists' });
    const res = await POST(req('http://x/api/v1/skills', { slug: 'my-skill', name: 'My skill', description: 'desc', body: 'b' }));
    expect(res.status).toBe(409);
  });

  it('201 creates a PENDING skill', async () => {
    h.findUnique.mockResolvedValue(null);
    h.create.mockResolvedValue({ id: 's1', slug: 'my-skill' });
    const res = await POST(req('http://x/api/v1/skills', { slug: 'my-skill', name: 'My skill', description: 'desc', body: 'b', category: 'GIT' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 's1', slug: 'my-skill', status: 'PENDING' });
    expect(h.create.mock.calls[0]![0].data.status).toBe('PENDING');
  });
});
