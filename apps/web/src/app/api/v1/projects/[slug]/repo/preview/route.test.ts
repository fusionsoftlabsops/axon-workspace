import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireSessionOrToken: vi.fn(),
  projectFindUnique: vi.fn(),
  repoReaderFor: vi.fn(),
  readFiles: vi.fn(),
  env: vi.fn(),
  repoFindFirst: vi.fn(),
  githubFileContent: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ requireSessionOrToken: h.requireSessionOrToken }));
vi.mock('@/lib/repo/reader', () => ({ repoReaderFor: h.repoReaderFor }));
vi.mock('@/lib/db', () => ({
  prisma: { project: { findUnique: h.projectFindUnique }, projectRepo: { findFirst: h.repoFindFirst } },
}));
vi.mock('@/lib/env', () => ({ env: h.env }));
vi.mock('@/lib/repo/github', async (orig) => ({
  ...(await orig<typeof import('@/lib/repo/github')>()),
  githubFileContent: h.githubFileContent,
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

describe('GET repo/preview', () => {
  it('401 auth fails', async () => {
    h.requireSessionOrToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await GET(url('?path=a.ts'), ctx)).status).toBe(401);
  });
  it('404 project missing', async () => {
    h.projectFindUnique.mockResolvedValue(null);
    expect((await GET(url('?path=a.ts'), ctx)).status).toBe(404);
  });
  it('412 sin reader local y sin repo GitHub + token', async () => {
    h.projectFindUnique.mockResolvedValue(member);
    h.repoReaderFor.mockResolvedValue(null);
    expect((await GET(url('?path=a.ts'), ctx)).status).toBe(412);
  });
  it('200 fallback GitHub por archivo (con slice)', async () => {
    h.projectFindUnique.mockResolvedValue(member);
    h.repoReaderFor.mockResolvedValue(null);
    h.env.mockReturnValue({ GITHUB_TOKEN: 'ghtok' });
    h.repoFindFirst.mockResolvedValue({ githubFullName: 'org/repo', defaultBranch: 'main' });
    h.githubFileContent.mockResolvedValue({ content: 'l1\nl2\nl3', bytes: 8, truncated: false });
    const res = await GET(url('?path=a.ts&start=2&end=3'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('github');
    expect(body.content).toBe('l2\nl3');
    expect(h.githubFileContent).toHaveBeenCalledWith('org/repo', 'main', 'a.ts', 'ghtok');
  });
  it('400 missing path', async () => {
    h.projectFindUnique.mockResolvedValue(member);
    h.repoReaderFor.mockResolvedValue({ readFiles: h.readFiles });
    expect((await GET(url(''), ctx)).status).toBe(400);
  });
  it('404 file not found', async () => {
    h.projectFindUnique.mockResolvedValue(member);
    h.repoReaderFor.mockResolvedValue({ readFiles: h.readFiles });
    h.readFiles.mockResolvedValue({ files: [] });
    expect((await GET(url('?path=a.ts'), ctx)).status).toBe(404);
  });
  it('400 when readFiles throws', async () => {
    h.projectFindUnique.mockResolvedValue(member);
    h.repoReaderFor.mockResolvedValue({ readFiles: h.readFiles });
    h.readFiles.mockRejectedValue(new Error('boom'));
    const res = await GET(url('?path=a.ts'), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('boom');
  });
  it('200 full file without range', async () => {
    h.projectFindUnique.mockResolvedValue(member);
    h.repoReaderFor.mockResolvedValue({ readFiles: h.readFiles });
    h.readFiles.mockResolvedValue({
      files: [{ path: 'a.ts', language: 'ts', truncated: false, bytes: 10, content: 'l1\nl2\nl3' }],
    });
    const res = await GET(url('?path=a.ts'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe('l1\nl2\nl3');
    expect(body.range).toBeNull();
  });
  it('200 sliced by line range', async () => {
    h.projectFindUnique.mockResolvedValue(member);
    h.repoReaderFor.mockResolvedValue({ readFiles: h.readFiles });
    h.readFiles.mockResolvedValue({
      files: [{ path: 'a.ts', language: 'ts', truncated: false, bytes: 10, content: 'l1\nl2\nl3\nl4' }],
    });
    const res = await GET(url('?path=a.ts&start=2&end=3'), ctx);
    const body = await res.json();
    expect(body.content).toBe('l2\nl3');
    expect(body.range).toEqual({ start: 2, end: 3 });
  });
});
