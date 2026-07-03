import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  repoFindMany: vi.fn(),
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

import { GET } from './route';

const ctx = { params: Promise.resolve({ slug: 'axon' }) };
const req = () => new NextRequest('http://localhost/x');

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
