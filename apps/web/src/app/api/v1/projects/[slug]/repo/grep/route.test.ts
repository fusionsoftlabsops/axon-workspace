import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireSessionOrToken: vi.fn(),
  projectFindUnique: vi.fn(),
  repoReaderFor: vi.fn(),
  grep: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ requireSessionOrToken: h.requireSessionOrToken }));
vi.mock('@/lib/repo/reader', () => ({ repoReaderFor: h.repoReaderFor }));
vi.mock('@/lib/db', () => ({ prisma: { project: { findUnique: h.projectFindUnique } } }));

import { POST } from './route';

const ctx = { params: Promise.resolve({ slug: 'proj' }) };
const authd = { userId: 'u1', via: 'session', scopes: [], projectSlugs: [] as string[] };
function req(body: unknown) {
  return new NextRequest('http://localhost/x', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireSessionOrToken.mockResolvedValue({ ...authd });
});

describe('POST repo/grep', () => {
  it('401 auth fails', async () => {
    h.requireSessionOrToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await POST(req({ pattern: 'x' }), ctx)).status).toBe(401);
  });
  it('400 invalid body', async () => {
    expect((await POST(req({ pattern: '' }), ctx)).status).toBe(400);
  });
  it('404 project missing', async () => {
    h.projectFindUnique.mockResolvedValue(null);
    expect((await POST(req({ pattern: 'x' }), ctx)).status).toBe(404);
  });
  it('412 when repo not configured', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', repoPath: null, members: [{ role: 'ADMIN' }] });
    h.repoReaderFor.mockResolvedValue(null);
    expect((await POST(req({ pattern: 'x' }), ctx)).status).toBe(412);
  });
  it('400 when grep throws', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', repoPath: '/r', members: [{ role: 'ADMIN' }] });
    h.repoReaderFor.mockResolvedValue({ grep: h.grep });
    h.grep.mockRejectedValue(new Error('bad pattern'));
    const res = await POST(req({ pattern: 'x' }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('bad pattern');
  });
  it('200 returns hits', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', repoPath: '/r', members: [{ role: 'ADMIN' }] });
    h.repoReaderFor.mockResolvedValue({ grep: h.grep });
    h.grep.mockResolvedValue([{ path: 'a.ts', line: 1 }]);
    const res = await POST(req({ pattern: 'foo', scope: ['src'] }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ pattern: 'foo', count: 1 });
    expect(h.grep).toHaveBeenCalledWith('foo', ['src']);
  });
});
