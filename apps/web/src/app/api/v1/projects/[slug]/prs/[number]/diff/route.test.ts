import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  repoFindMany: vi.fn(),
  env: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireApiToken: h.requireApiToken,
  tokenAllowsProject: () => true,
}));
vi.mock('@/lib/db', () => ({
  prisma: { project: { findUnique: h.projectFindUnique }, projectRepo: { findMany: h.repoFindMany } },
}));
vi.mock('@/lib/env', () => ({ env: h.env }));

import { GET } from './route';

const fetchMock = vi.fn();
const realFetch = globalThis.fetch;
const ctx = { params: Promise.resolve({ slug: 'axon', number: '52' }) };
function req() {
  return new NextRequest('http://localhost/api/v1/projects/axon/prs/52/diff');
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockReset();
  h.requireApiToken.mockResolvedValue({ userId: 'u1', scopes: [], projectSlugs: [] });
  h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'ADMIN' }] });
  h.env.mockReturnValue({ GITHUB_TOKEN: 'ghtok' });
  h.repoFindMany.mockResolvedValue([{ name: 'axon-workspace', githubFullName: 'org/axon-workspace' }]);
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('GET pr diff', () => {
  it('400 con número inválido', async () => {
    const res = await GET(req(), { params: Promise.resolve({ slug: 'axon', number: 'x' }) });
    expect(res.status).toBe(400);
  });
  it('404 sin repo GitHub', async () => {
    h.repoFindMany.mockResolvedValue([]);
    expect((await GET(req(), ctx)).status).toBe(404);
  });
  it('200 devuelve metadatos + diff (json meta luego text diff)', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ title: 'badge', state: 'closed', merged_at: '2026-07-03', additions: 151, deletions: 20, changed_files: 3, head: { ref: 'agent/hu-28' }, html_url: 'u' }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'diff --git a/x b/x\n+badge' });
    const res = await GET(req(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ number: 52, additions: 151, changedFiles: 3, merged: true, truncated: false });
    expect(body.diff).toContain('diff --git');
  });
  it('502 si GitHub falla', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}), text: async () => '' });
    expect((await GET(req(), ctx)).status).toBe(502);
  });
});
