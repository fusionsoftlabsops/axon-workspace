import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  taskFindUnique: vi.fn(),
  taskUpdate: vi.fn(),
  activityCreate: vi.fn(),
  commentCreate: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
  extract: vi.fn(),
  publishEvent: vi.fn(),
  blockReason: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireApiToken: h.requireApiToken,
  tokenAllowsProject: (a: { projectSlugs: string[] }, s: string) =>
    a.projectSlugs.length === 0 || a.projectSlugs.includes(s),
}));
vi.mock('@/lib/audit', () => ({ audit: h.audit }));
vi.mock('@/lib/actions/brain', () => ({ extractMemoriesFromTaskAction: h.extract }));
vi.mock('@/lib/agents/events', () => ({ publishDomainEvent: h.publishEvent }));
vi.mock('@/lib/agents/provision', () => ({ selfApprovalBlockReason: h.blockReason }));
vi.mock('@/lib/db', () => ({
  prisma: {
    project: { findUnique: h.projectFindUnique },
    task: { findUnique: h.taskFindUnique },
    $transaction: h.transaction,
  },
}));

import { POST } from './route';

const ctx = (taskNumber = '7') => ({ params: Promise.resolve({ slug: 'axon', taskNumber }) });
const authd = { userId: 'u-qa', tokenId: 't1', scopes: [], projectSlugs: [] as string[] };

function project(role = 'MEMBER') {
  return {
    id: 'p1',
    members: [{ role }],
    workflows: [{ states: [
      { id: 's-dev', name: 'Desarrollo', category: 'IN_PROGRESS' },
      { id: 's-rev', name: 'Verificación', category: 'REVIEW' },
      { id: 's-done', name: 'Terminada', category: 'DONE' },
    ] }],
  };
}
const TASK = { id: 't1', stateId: 's-rev', assigneeId: 'u-dev', qaHandoff: { submittedById: 'u-dev' } };

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
  h.blockReason.mockResolvedValue(null);
  h.projectFindUnique.mockResolvedValue(project());
  h.taskFindUnique.mockResolvedValue({ ...TASK });
  h.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      task: { update: h.taskUpdate },
      taskActivity: { create: h.activityCreate },
      taskComment: { create: h.commentCreate },
    }),
  );
});

describe('POST qa-decision', () => {
  it('400 invalid taskNumber', async () => {
    expect((await POST(req({ decision: 'approve' }), ctx('x'))).status).toBe(400);
  });

  it('401 auth fails', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await POST(req({ decision: 'approve' }), ctx())).status).toBe(401);
  });

  it('403 viewer', async () => {
    h.projectFindUnique.mockResolvedValue(project('VIEWER'));
    expect((await POST(req({ decision: 'approve' }), ctx())).status).toBe(403);
  });

  it('400 reject without comment', async () => {
    const res = await POST(req({ decision: 'reject' }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('actionable');
  });

  it('approve moves to DONE, comments, audits, extracts and emits the event', async () => {
    h.extract.mockResolvedValue({ ok: true });
    const res = await POST(req({ decision: 'approve', comment: 'todo verificado' }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, decision: 'approve', movedTo: 'Terminada' });
    expect(h.taskUpdate).toHaveBeenCalledWith({ where: { id: 't1' }, data: { stateId: 's-done' } });
    expect(h.commentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ body: expect.stringContaining('✅') }) }),
    );
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'task.qa_decision' }));
    expect(h.publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'story.state_changed',
        toState: { id: 's-done', name: 'Terminada', category: 'DONE' },
        payload: { via: 'qa-decision', decision: 'approve' },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(h.extract).toHaveBeenCalled();
  });

  it('reject moves back to IN_PROGRESS with the actionable comment and no extraction', async () => {
    const res = await POST(req({ decision: 'reject', comment: 'falta el test del guardarrail' }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ decision: 'reject', movedTo: 'Desarrollo' });
    expect(h.taskUpdate).toHaveBeenCalledWith({ where: { id: 't1' }, data: { stateId: 's-dev' } });
    expect(h.commentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ body: expect.stringContaining('falta el test') }) }),
    );
    expect(h.extract).not.toHaveBeenCalled();
    expect(h.blockReason).not.toHaveBeenCalled(); // guardrail solo aplica a approve
  });

  it('403 guardrail on approve when the actor developed the story', async () => {
    h.blockReason.mockResolvedValue('guardrail: el agente DEV no puede aprobar su propio trabajo');
    const res = await POST(req({ decision: 'approve' }), ctx());
    expect(res.status).toBe(403);
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'task.self_approval_blocked' }));
  });

  it('does not emit an event when already in the target state', async () => {
    h.taskFindUnique.mockResolvedValue({ ...TASK, stateId: 's-done' });
    h.extract.mockResolvedValue({ ok: true });
    const res = await POST(req({ decision: 'approve' }), ctx());
    expect(res.status).toBe(200);
    expect(h.publishEvent).not.toHaveBeenCalled();
  });
});
