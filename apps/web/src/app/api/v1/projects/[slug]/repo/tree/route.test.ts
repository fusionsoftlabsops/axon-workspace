import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireSessionOrToken: vi.fn(),
  projectFindUnique: vi.fn(),
  repoReaderFor: vi.fn(),
  tree: vi.fn(),
  env: vi.fn(),
  repoFindFirst: vi.fn(),
  githubRepoTree: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ requireSessionOrToken: h.requireSessionOrToken }));
vi.mock('@/lib/repo/reader', () => ({ repoReaderFor: h.repoReaderFor }));
vi.mock('@/lib/db', () => ({
  prisma: { project: { findUnique: h.projectFindUnique }, projectRepo: { findFirst: h.repoFindFirst } },
}));
vi.mock('@/lib/env', () => ({ env: h.env }));
vi.mock('@/lib/repo/github', async (orig) => ({
  ...(await orig<typeof import('@/lib/repo/github')>()),
  githubRepoTree: h.githubRepoTree,
}));

import { GET } from './route';

const ctx = { params: Promise.resolve({ slug: 'proj' }) };
const authd = { userId: 'u1', via: 'session', scopes: [], projectSlugs: [] as string[] };
const url = (q = '') => new NextRequest(`http://localhost/x${q}`);
const member = { id: 'p1', repoPath: '/r', members: [{ role: 'ADMIN' }] };

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireSessionOrToken.mockResolvedValue({ ...authd });
  h.env.mockReturnValue({ GITHUB_TOKEN: undefined });
  h.repoFindFirst.mockResolvedValue(null);
});

describe('GET repo/tree', () => {
  it('401 auth fails', async () => {
    h.requireSessionOrToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await GET(url(), ctx)).status).toBe(401);
  });
  it('404 project missing', async () => {
    h.projectFindUnique.mockResolvedValue(null);
    expect((await GET(url(), ctx)).status).toBe(404);
  });
  it('412 sin reader local y sin repo GitHub + token', async () => {
    h.projectFindUnique.mockResolvedValue(member);
    h.repoReaderFor.mockResolvedValue(null);
    expect((await GET(url(), ctx)).status).toBe(412);
  });
  it('200 fallback GitHub cuando no hay clon local', async () => {
    h.projectFindUnique.mockResolvedValue(member);
    h.repoReaderFor.mockResolvedValue(null);
    h.env.mockReturnValue({ GITHUB_TOKEN: 'ghtok' });
    h.repoFindFirst.mockResolvedValue({ githubFullName: 'org/repo', defaultBranch: 'main' });
    h.githubRepoTree.mockResolvedValue([{ path: 'src', type: 'tree' }]);
    const res = await GET(url('?root=.&depth=2'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('github');
    expect(h.githubRepoTree).toHaveBeenCalledWith('org/repo', 'main', 'ghtok');
  });
  it('400 when tree throws', async () => {
    h.projectFindUnique.mockResolvedValue(member);
    h.repoReaderFor.mockResolvedValue({ tree: h.tree });
    h.tree.mockRejectedValue(new Error('boom'));
    const res = await GET(url(), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('boom');
  });
  it('200 default root/depth', async () => {
    h.projectFindUnique.mockResolvedValue(member);
    h.repoReaderFor.mockResolvedValue({ tree: h.tree });
    h.tree.mockResolvedValue([{ name: 'src', type: 'dir' }]);
    const res = await GET(url(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ root: '.', depth: 2 });
    expect(h.tree).toHaveBeenCalledWith({ root: '.', maxDepth: 2 });
  });
  it('200 clamps depth and uses provided root', async () => {
    h.projectFindUnique.mockResolvedValue(member);
    h.repoReaderFor.mockResolvedValue({ tree: h.tree });
    h.tree.mockResolvedValue([]);
    await GET(url('?root=apps/web&depth=99'), ctx);
    expect(h.tree).toHaveBeenCalledWith({ root: 'apps/web', maxDepth: 6 });
  });
});
