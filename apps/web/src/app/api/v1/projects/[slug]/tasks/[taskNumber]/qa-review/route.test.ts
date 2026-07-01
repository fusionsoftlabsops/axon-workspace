import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  taskFindUnique: vi.fn(),
  txTaskUpdate: vi.fn(),
  txActivityCreate: vi.fn(),
  txCommentCreate: vi.fn(),
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
    task: { findUnique: h.taskFindUnique },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        task: { update: h.txTaskUpdate },
        taskActivity: { create: h.txActivityCreate },
        taskComment: { create: h.txCommentCreate },
      }),
  },
}));

import { POST } from './route';

const ctx = { params: Promise.resolve({ slug: 'proj', taskNumber: '9' }) };
const authd = { userId: 'u1', tokenId: 't1', scopes: [], projectSlugs: [] as string[] };
function req(body: unknown) {
  return new NextRequest('http://localhost/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const projectWith = (role = 'MEMBER') => ({
  id: 'p1',
  members: [{ role }],
  workflows: [
    {
      states: [
        { id: 's-open', category: 'OPEN' },
        { id: 's-review', category: 'REVIEW' },
      ],
    },
  ],
});

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireApiToken.mockResolvedValue({ ...authd });
});

describe('POST qa-review', () => {
  it('401 auth fails', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await POST(req({}), ctx)).status).toBe(401);
  });
  it('403 not scoped', async () => {
    h.requireApiToken.mockResolvedValue({ ...authd, projectSlugs: ['other'] });
    expect((await POST(req({}), ctx)).status).toBe(403);
  });
  it('403 viewer', async () => {
    h.projectFindUnique.mockResolvedValue(projectWith('VIEWER'));
    expect((await POST(req({}), ctx)).status).toBe(403);
  });
  it('404 task missing', async () => {
    h.projectFindUnique.mockResolvedValue(projectWith());
    h.taskFindUnique.mockResolvedValue(null);
    expect((await POST(req({}), ctx)).status).toBe(404);
  });
  it('400 invalid body', async () => {
    h.projectFindUnique.mockResolvedValue(projectWith());
    h.taskFindUnique.mockResolvedValue({ id: 't1', stateId: 's-open' });
    // criterion missing `met`
    expect((await POST(req({ criteria: [{ text: 'x' }] }), ctx)).status).toBe(400);
  });
  it('200 stores handoff, posts comment and moves to Verificación', async () => {
    h.projectFindUnique.mockResolvedValue(projectWith());
    h.taskFindUnique.mockResolvedValue({ id: 't1', stateId: 's-open' });
    const res = await POST(
      req({
        criteria: [{ text: 'works', met: true }],
        suggestedTests: ['login ok', { title: 'edge', expected: 'error' }],
        executedTasks: ['form'],
        notes: 'ctx',
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, movedToVerification: true });
    const data = h.txTaskUpdate.mock.calls[0]![0].data;
    expect(data.stateId).toBe('s-review');
    expect(data.qaHandoff.suggestedTests).toEqual([{ title: 'login ok' }, { title: 'edge', expected: 'error' }]);
    expect(h.txCommentCreate).toHaveBeenCalled();
  });
  it('200 without moving when moveToVerification=false', async () => {
    h.projectFindUnique.mockResolvedValue(projectWith());
    h.taskFindUnique.mockResolvedValue({ id: 't1', stateId: 's-open' });
    const res = await POST(req({ moveToVerification: false }), ctx);
    expect(await res.json()).toEqual({ ok: true, movedToVerification: false });
    expect(h.txTaskUpdate.mock.calls[0]![0].data.stateId).toBeUndefined();
  });
});
