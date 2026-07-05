import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  repoFindMany: vi.fn(),
  audit: vi.fn(),
  linkProjectRepo: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireApiToken: h.requireApiToken,
  tokenAllowsProject: (a: { projectSlugs: string[] }, s: string) =>
    a.projectSlugs.length === 0 || a.projectSlugs.includes(s),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    project: { findUnique: h.projectFindUnique },
    projectRepo: { findMany: h.repoFindMany },
  },
}));
vi.mock('@/lib/audit', () => ({ audit: h.audit }));
vi.mock('@/lib/repo/link', () => ({ linkProjectRepo: h.linkProjectRepo }));

import { GET, POST } from './route';

const ctx = { params: Promise.resolve({ slug: 'axon' }) };
const req = () => new NextRequest('http://localhost/x');
const postReq = (body: unknown) =>
  new NextRequest('http://localhost/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireApiToken.mockResolvedValue({ userId: 'u1', tokenId: 't1', scopes: [], projectSlugs: [] });
  h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'MEMBER' }] });
});

describe('GET repos', () => {
  it('401 cuando la auth falla', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await GET(req(), ctx)).status).toBe(401);
  });

  it('404 cuando no es miembro', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [] });
    expect((await GET(req(), ctx)).status).toBe(404);
  });

  it('lista repos con defaultBranch normalizado', async () => {
    h.repoFindMany.mockResolvedValue([
      { name: 'ws', kind: 'other', url: 'https://github.com/o/r', githubFullName: 'o/r', defaultBranch: null },
    ]);
    const body = await (await GET(req(), ctx)).json();
    expect(body.repos[0]).toEqual({
      name: 'ws',
      kind: 'other',
      url: 'https://github.com/o/r',
      githubFullName: 'o/r',
      defaultBranch: 'main',
    });
  });
});

describe('POST repos (vincular)', () => {
  const body = { name: 'idea-forge-backend', url: 'https://github.com/fusionsoftlabsops/idea-forge-backend', kind: 'backend' };
  it('403 para VIEWER', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'VIEWER' }] });
    expect((await POST(postReq(body), ctx)).status).toBe(403);
  });
  it('400 body inválido', async () => {
    expect((await POST(postReq({ name: '' }), ctx)).status).toBe(400);
  });
  it('201 vincula el repo y audita', async () => {
    h.linkProjectRepo.mockResolvedValue({ id: 'r1', name: body.name, kind: 'backend', url: body.url, githubFullName: 'fusionsoftlabsops/idea-forge-backend', defaultBranch: 'main' });
    const res = await POST(postReq(body), ctx);
    expect(res.status).toBe(201);
    expect(h.linkProjectRepo).toHaveBeenCalledWith('p1', body);
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'project.update' }));
    expect((await res.json()).repo.githubFullName).toBe('fusionsoftlabsops/idea-forge-backend');
  });
});
