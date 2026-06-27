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

import { POST } from './route';

const ctx = { params: Promise.resolve({ slug: 'proj', id: 'm1' }) };
const authd = { userId: 'u1', tokenId: 't1', scopes: [], projectSlugs: [] as string[] };
const req = () => new NextRequest('http://localhost/x', { method: 'POST' });

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireApiToken.mockResolvedValue({ ...authd });
});

describe('POST publish', () => {
  it('401 auth fails', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await POST(req(), ctx)).status).toBe(401);
  });
  it('403 not scoped', async () => {
    h.requireApiToken.mockResolvedValue({ ...authd, projectSlugs: ['o'] });
    expect((await POST(req(), ctx)).status).toBe(403);
  });
  it('404 when missing', async () => {
    h.memoryFindUnique.mockResolvedValue(null);
    expect((await POST(req(), ctx)).status).toBe(404);
  });
  it('404 slug mismatch', async () => {
    h.memoryFindUnique.mockResolvedValue({
      scope: 'LOCAL', ownerUserId: 'u1',
      project: { id: 'p1', slug: 'other', members: [{ role: 'OWNER' }] },
    });
    expect((await POST(req(), ctx)).status).toBe(404);
  });
  it('400 when already PROJECT', async () => {
    h.memoryFindUnique.mockResolvedValue({
      scope: 'PROJECT', ownerUserId: null,
      project: { id: 'p1', slug: 'proj', members: [{ role: 'OWNER' }] },
    });
    expect((await POST(req(), ctx)).status).toBe(400);
  });
  it('403 when not owner/admin', async () => {
    h.memoryFindUnique.mockResolvedValue({
      scope: 'LOCAL', ownerUserId: 'other',
      project: { id: 'p1', slug: 'proj', members: [{ role: 'MEMBER' }] },
    });
    expect((await POST(req(), ctx)).status).toBe(403);
  });
  it('200 publishes (owner)', async () => {
    h.memoryFindUnique.mockResolvedValue({
      scope: 'LOCAL', ownerUserId: 'u1',
      project: { id: 'p1', slug: 'proj', members: [{ role: 'MEMBER' }] },
    });
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    expect(h.memoryUpdate).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { scope: 'PROJECT', ownerUserId: null } });
    expect(h.audit).toHaveBeenCalled();
  });
});
