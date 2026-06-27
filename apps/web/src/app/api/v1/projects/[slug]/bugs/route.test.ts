import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  counterUpdate: vi.fn(),
  taskCreate: vi.fn(),
  activityCreate: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireApiToken: h.requireApiToken,
  tokenAllowsProject: (a: { projectSlugs: string[] }, s: string) =>
    a.projectSlugs.length === 0 || a.projectSlugs.includes(s),
}));
vi.mock('@/lib/audit', () => ({ audit: h.audit }));
vi.mock('@/lib/db', () => ({
  prisma: {
    project: { findUnique: h.projectFindUnique },
    projectTaskCounter: { update: h.counterUpdate },
    task: { create: h.taskCreate },
    taskActivity: { create: h.activityCreate },
    $transaction: h.transaction,
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
function project(role = 'ADMIN', states: unknown[] = [{ id: 's1' }]) {
  return { id: 'p1', members: [{ role }], workflows: [{ states }] };
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireApiToken.mockResolvedValue({ ...authd });
  h.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      projectTaskCounter: { update: h.counterUpdate },
      task: { create: h.taskCreate },
      taskActivity: { create: h.activityCreate },
    }),
  );
});

const valid = { title: 'Bug', description: 'broken' };

describe('POST bug', () => {
  it('403 not scoped', async () => {
    h.requireApiToken.mockResolvedValue({ ...authd, projectSlugs: ['o'] });
    expect((await POST(req(valid), ctx)).status).toBe(403);
  });
  it('401 auth fails', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await POST(req(valid), ctx)).status).toBe(401);
  });
  it('400 invalid body', async () => {
    expect((await POST(req({ title: '' }), ctx)).status).toBe(400);
  });
  it('404 project missing', async () => {
    h.projectFindUnique.mockResolvedValue(null);
    expect((await POST(req(valid), ctx)).status).toBe(404);
  });
  it('403 viewer', async () => {
    h.projectFindUnique.mockResolvedValue(project('VIEWER'));
    expect((await POST(req(valid), ctx)).status).toBe(403);
  });
  it('500 when no workflow state', async () => {
    h.projectFindUnique.mockResolvedValue(project('ADMIN', []));
    expect((await POST(req(valid), ctx)).status).toBe(500);
  });
  it('201 creates a bug with repro + stack', async () => {
    h.projectFindUnique.mockResolvedValue(project());
    h.counterUpdate.mockResolvedValue({ next: 8 });
    h.taskCreate.mockResolvedValue({ id: 'b1', taskNumber: 7, title: '🐛 Bug' });
    const res = await POST(
      req({ ...valid, reproSteps: 'do x', stackTrace: 'at y' }),
      ctx,
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: 'b1', number: 7 });
    const desc = h.taskCreate.mock.calls[0][0].data.description;
    expect(desc).toContain('Pasos para reproducir');
    expect(desc).toContain('Stack trace');
    expect(h.audit).toHaveBeenCalled();
  });
  it('201 minimal bug without optional sections', async () => {
    h.projectFindUnique.mockResolvedValue(project());
    h.counterUpdate.mockResolvedValue({ next: 2 });
    h.taskCreate.mockResolvedValue({ id: 'b2', taskNumber: 1, title: '🐛 Bug' });
    const res = await POST(req(valid), ctx);
    expect(res.status).toBe(201);
    const desc = h.taskCreate.mock.calls[0][0].data.description;
    expect(desc).not.toContain('Pasos para reproducir');
  });
});
