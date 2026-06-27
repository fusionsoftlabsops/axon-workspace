import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  taskFindUnique: vi.fn(),
  invokeAi: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireApiToken: h.requireApiToken,
  tokenAllowsProject: (a: { projectSlugs: string[] }, s: string) =>
    a.projectSlugs.length === 0 || a.projectSlugs.includes(s),
}));
vi.mock('@/lib/ai/router', () => ({ invokeAi: h.invokeAi }));
vi.mock('@/lib/db', () => ({
  prisma: { project: { findUnique: h.projectFindUnique }, task: { findUnique: h.taskFindUnique } },
}));

import { POST } from './route';

const ctx = (taskNumber = '5') => ({ params: Promise.resolve({ slug: 'proj', taskNumber }) });
const authd = { userId: 'u1', tokenId: 't1', scopes: [], projectSlugs: [] as string[] };
function req(body: unknown) {
  return new NextRequest('http://localhost/x', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireApiToken.mockResolvedValue({ ...authd });
});

describe('POST ai/pr-description', () => {
  it('401 auth fails', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await POST(req({}), ctx())).status).toBe(401);
  });
  it('403 not scoped', async () => {
    h.requireApiToken.mockResolvedValue({ ...authd, projectSlugs: ['o'] });
    expect((await POST(req({}), ctx())).status).toBe(403);
  });
  it('400 invalid body type', async () => {
    expect((await POST(req({ diffStats: 123 }), ctx())).status).toBe(400);
  });
  it('404 project missing', async () => {
    h.projectFindUnique.mockResolvedValue(null);
    expect((await POST(req({}), ctx())).status).toBe(404);
  });
  it('404 task missing', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ id: 'm1' }] });
    h.taskFindUnique.mockResolvedValue(null);
    expect((await POST(req({}), ctx())).status).toBe(404);
  });
  it('500 when AI throws', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ id: 'm1' }] });
    h.taskFindUnique.mockResolvedValue({ id: 't1', taskNumber: 5, title: 'T', description: 'D' });
    h.invokeAi.mockRejectedValue(new Error('ai down'));
    const res = await POST(req({ diffStats: 's' }), ctx());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('ai down');
  });
  it('200 with diffStats and description', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ id: 'm1' }] });
    h.taskFindUnique.mockResolvedValue({ id: 't1', taskNumber: 5, title: 'T', description: 'D' });
    h.invokeAi.mockResolvedValue({ output: 'PR body', model: 'claude' });
    const res = await POST(req({ diffStats: 'files' }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ description: 'PR body', model: 'claude' });
    expect(h.invokeAi.mock.calls[0][0].context).toContain('Archivos cambiados');
  });
  it('200 with null body (empty) and no description', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ id: 'm1' }] });
    h.taskFindUnique.mockResolvedValue({ id: 't1', taskNumber: 5, title: 'T', description: null });
    h.invokeAi.mockResolvedValue({ output: 'PR body', model: 'claude' });
    const res = await POST(req(undefined), ctx());
    expect(res.status).toBe(200);
  });
});
