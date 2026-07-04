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
const ctx = { params: Promise.resolve({ slug: 'axon' }) };
function req(qs = '') {
  return new NextRequest(`http://localhost/api/v1/projects/axon/prs${qs}`);
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

describe('GET prs', () => {
  it('501 sin GITHUB_TOKEN', async () => {
    h.env.mockReturnValue({});
    expect((await GET(req(), ctx)).status).toBe(501);
  });
  it('404 si el proyecto no tiene repos de GitHub', async () => {
    h.repoFindMany.mockResolvedValue([{ name: 'x', githubFullName: null, url: null }]);
    expect((await GET(req(), ctx)).status).toBe(404);
  });
  it('mapea agent/hu-N → storyNumber', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { number: 52, title: 'badge', state: 'closed', merged_at: '2026-07-03', html_url: 'u', created_at: 'c', user: { login: 'bot' }, head: { ref: 'agent/hu-28' } },
        { number: 66, title: 'hybrid', state: 'open', merged_at: null, html_url: 'u', created_at: 'c', head: { ref: 'feat/x' } },
      ],
    });
    const res = await GET(req('?state=all'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(fetchMock.mock.calls[0]![0]).toContain('/repos/org/axon-workspace/pulls?state=all');
    expect(body.prs[0]).toMatchObject({ number: 52, storyNumber: 28, merged: true });
    expect(body.prs[1]).toMatchObject({ number: 66, storyNumber: null });
  });
  it('captura el error por repo sin romper la respuesta', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    const res = await GET(req(), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).prs[0]).toHaveProperty('error');
  });
});
