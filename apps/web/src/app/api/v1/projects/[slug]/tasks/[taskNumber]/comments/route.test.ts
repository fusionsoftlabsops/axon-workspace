import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  taskFindUnique: vi.fn(),
  commentCreate: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireApiToken: h.requireApiToken,
  tokenAllowsProject: (a: { projectSlugs: string[] }, s: string) =>
    a.projectSlugs.length === 0 || a.projectSlugs.includes(s),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    project: { findUnique: h.projectFindUnique },
    task: { findUnique: h.taskFindUnique },
    taskComment: { create: h.commentCreate },
  },
}));

import { POST } from './route';

const ctx = (taskNumber = '5') => ({ params: Promise.resolve({ slug: 'proj', taskNumber }) });
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

describe('POST comment', () => {
  it('400 invalid taskNumber', async () => {
    expect((await POST(req({ body: 'x' }), ctx('x'))).status).toBe(400);
  });
  it('401 auth fails', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await POST(req({ body: 'x' }), ctx())).status).toBe(401);
  });
  it('403 not scoped', async () => {
    h.requireApiToken.mockResolvedValue({ ...authd, projectSlugs: ['o'] });
    expect((await POST(req({ body: 'x' }), ctx())).status).toBe(403);
  });
  it('404 project missing', async () => {
    h.projectFindUnique.mockResolvedValue(null);
    expect((await POST(req({ body: 'x' }), ctx())).status).toBe(404);
  });
  it('403 viewer', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'VIEWER' }] });
    expect((await POST(req({ body: 'x' }), ctx())).status).toBe(403);
  });
  it('404 task missing', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'ADMIN' }] });
    h.taskFindUnique.mockResolvedValue(null);
    expect((await POST(req({ body: 'x' }), ctx())).status).toBe(404);
  });
  it('400 invalid body', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'ADMIN' }] });
    h.taskFindUnique.mockResolvedValue({ id: 't1' });
    expect((await POST(req({ body: '' }), ctx())).status).toBe(400);
  });
  it('201 creates a comment', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'ADMIN' }] });
    h.taskFindUnique.mockResolvedValue({ id: 't1' });
    h.commentCreate.mockResolvedValue({ id: 'c1', createdAt: new Date('2030-01-01') });
    const res = await POST(req({ body: '  hello  ' }), ctx());
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: 'c1' });
    expect(h.commentCreate.mock.calls[0][0].data.body).toBe('hello');
  });
});
