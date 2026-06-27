import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  taskFindUnique: vi.fn(),
  extract: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireApiToken: h.requireApiToken,
  tokenAllowsProject: (a: { projectSlugs: string[] }, s: string) =>
    a.projectSlugs.length === 0 || a.projectSlugs.includes(s),
}));
vi.mock('@/lib/actions/brain', () => ({ extractMemoriesFromTaskAction: h.extract }));
vi.mock('@/lib/db', () => ({
  prisma: {
    project: { findUnique: h.projectFindUnique },
    task: { findUnique: h.taskFindUnique },
  },
}));

import { POST } from './route';

const ctx = { params: Promise.resolve({ slug: 'proj' }) };
const authd = { userId: 'u1', tokenId: 't1', scopes: [], projectSlugs: [] as string[] };
function req(body: unknown) {
  return new NextRequest('http://localhost/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireApiToken.mockResolvedValue({ ...authd });
});

describe('POST brain/extract', () => {
  it('401 auth fails', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await POST(req({ taskNumber: 1 }), ctx)).status).toBe(401);
  });
  it('403 not scoped', async () => {
    h.requireApiToken.mockResolvedValue({ ...authd, projectSlugs: ['o'] });
    expect((await POST(req({ taskNumber: 1 }), ctx)).status).toBe(403);
  });
  it('400 invalid body', async () => {
    expect((await POST(req({ taskNumber: 0 }), ctx)).status).toBe(400);
  });
  it('404 project missing', async () => {
    h.projectFindUnique.mockResolvedValue(null);
    expect((await POST(req({ taskNumber: 1 }), ctx)).status).toBe(404);
  });
  it('404 task missing', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ id: 'm1' }] });
    h.taskFindUnique.mockResolvedValue(null);
    expect((await POST(req({ taskNumber: 1 }), ctx)).status).toBe(404);
  });
  it('400 when extractor fails', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ id: 'm1' }] });
    h.taskFindUnique.mockResolvedValue({ id: 't1' });
    h.extract.mockResolvedValue({ ok: false, error: 'nope' });
    const res = await POST(req({ taskNumber: 1 }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('nope');
  });
  it('200 returns memory ids', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ id: 'm1' }] });
    h.taskFindUnique.mockResolvedValue({ id: 't1' });
    h.extract.mockResolvedValue({ ok: true, data: { memoryIds: ['m1', 'm2'] } });
    const res = await POST(req({ taskNumber: 1 }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, memoryIds: ['m1', 'm2'] });
  });
  it('200 defaults memoryIds to [] when absent', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ id: 'm1' }] });
    h.taskFindUnique.mockResolvedValue({ id: 't1' });
    h.extract.mockResolvedValue({ ok: true, data: undefined });
    const res = await POST(req({ taskNumber: 1 }), ctx);
    expect((await res.json()).memoryIds).toEqual([]);
  });
});
