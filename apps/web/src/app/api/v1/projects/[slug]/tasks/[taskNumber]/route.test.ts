import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  taskFindUnique: vi.fn(),
  taskUpdate: vi.fn(),
  activityCreate: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
  extract: vi.fn(),
  publishEvent: vi.fn(),
  blockReason: vi.fn(),
  agentFindUnique: vi.fn(),
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
    task: { findUnique: h.taskFindUnique, update: h.taskUpdate },
    taskActivity: { create: h.activityCreate },
    agent: { findUnique: h.agentFindUnique },
    $transaction: h.transaction,
  },
}));

import { GET, PATCH } from './route';

const ctx = (taskNumber = '5') => ({ params: Promise.resolve({ slug: 'proj', taskNumber }) });
const authd = { userId: 'u1', tokenId: 't1', scopes: [], projectSlugs: [] as string[] };

function project(role = 'ADMIN') {
  return {
    id: 'p1',
    members: [{ role }],
    workflows: [{ states: [
      { id: 's1', name: 'Todo', category: 'TODO' },
      { id: 's2', name: 'Done', category: 'DONE' },
    ] }],
  };
}
function task(over: Record<string, unknown> = {}) {
  return {
    id: 't1', taskNumber: 5, title: 'A', description: 'D', priority: 'LOW',
    dueDate: null,
    state: { id: 's1', name: 'Todo', category: 'TODO' },
    assignee: null, reporter: { id: 'r1', name: 'R' },
    comments: [{ author: { id: 'a', name: 'Au' }, body: 'hi', createdAt: new Date('2030-01-01') }],
    subtasks: [{ id: 'st1', taskNumber: 6, title: 'sub', state: { name: 'Todo' } }],
    ...over,
  };
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireApiToken.mockResolvedValue({ ...authd });
  h.blockReason.mockResolvedValue(null);
  h.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({ task: { update: h.taskUpdate }, taskActivity: { create: h.activityCreate } }),
  );
});

describe('GET task detail', () => {
  it('400 invalid taskNumber', async () => {
    const res = await GET(new NextRequest('http://localhost/x'), ctx('abc'));
    expect(res.status).toBe(400);
  });
  it('401 auth fails', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    const res = await GET(new NextRequest('http://localhost/x'), ctx());
    expect(res.status).toBe(401);
  });
  it('403 not scoped', async () => {
    h.requireApiToken.mockResolvedValue({ ...authd, projectSlugs: ['o'] });
    const res = await GET(new NextRequest('http://localhost/x'), ctx());
    expect(res.status).toBe(403);
  });
  it('404 when project missing', async () => {
    h.projectFindUnique.mockResolvedValue(null);
    const res = await GET(new NextRequest('http://localhost/x'), ctx());
    expect(res.status).toBe(404);
  });
  it('404 when task missing', async () => {
    h.projectFindUnique.mockResolvedValue(project());
    h.taskFindUnique.mockResolvedValue(null);
    const res = await GET(new NextRequest('http://localhost/x'), ctx());
    expect(res.status).toBe(404);
  });
  it('200 returns full task', async () => {
    h.projectFindUnique.mockResolvedValue(project());
    h.taskFindUnique.mockResolvedValue(task());
    const res = await GET(new NextRequest('http://localhost/x'), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ number: 5, project: 'proj', reporter: { id: 'r1', name: 'R' } });
    expect(body.subtasks[0]).toMatchObject({ number: 6, state: 'Todo' });
    expect(body.comments[0]).toMatchObject({ author: 'Au', body: 'hi' });
  });
  it('200 with empty description fallback', async () => {
    h.projectFindUnique.mockResolvedValue(project());
    h.taskFindUnique.mockResolvedValue(task({ description: null, dueDate: new Date('2030-02-02') }));
    const res = await GET(new NextRequest('http://localhost/x'), ctx());
    const body = await res.json();
    expect(body.description).toBe('');
    expect(body.dueDate).toBe('2030-02-02T00:00:00.000Z');
  });
});

describe('PATCH task', () => {
  function req(body: unknown) {
    return new NextRequest('http://localhost/x', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  it('400 invalid taskNumber', async () => {
    const res = await PATCH(req({ title: 'x' }), ctx('0'));
    expect(res.status).toBe(400);
  });
  it('403 not scoped', async () => {
    h.requireApiToken.mockResolvedValue({ ...authd, projectSlugs: ['o'] });
    const res = await PATCH(req({ title: 'x' }), ctx());
    expect(res.status).toBe(403);
  });
  it('404 when not found', async () => {
    h.projectFindUnique.mockResolvedValue(project());
    h.taskFindUnique.mockResolvedValue(null);
    const res = await PATCH(req({ title: 'x' }), ctx());
    expect(res.status).toBe(404);
  });
  it('403 when viewer', async () => {
    h.projectFindUnique.mockResolvedValue(project('VIEWER'));
    h.taskFindUnique.mockResolvedValue(task());
    const res = await PATCH(req({ title: 'x' }), ctx());
    expect(res.status).toBe(403);
  });
  it('400 invalid body (empty)', async () => {
    h.projectFindUnique.mockResolvedValue(project());
    h.taskFindUnique.mockResolvedValue(task());
    const res = await PATCH(req({}), ctx());
    expect(res.status).toBe(400);
  });
  it('400 when toState not found', async () => {
    h.projectFindUnique.mockResolvedValue(project());
    h.taskFindUnique.mockResolvedValue(task());
    const res = await PATCH(req({ toState: 'Nope' }), ctx());
    expect(res.status).toBe(400);
  });
  it('200 updates fields without state change', async () => {
    h.projectFindUnique.mockResolvedValue(project());
    h.taskFindUnique.mockResolvedValue(task());
    const res = await PATCH(req({ title: 'New', description: 'x', priority: 'HIGH' }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.extract).not.toHaveBeenCalled();
  });
  it('persiste artefactos generativos (runtime LOCAL): acceptanceCriteria + techDesign', async () => {
    h.projectFindUnique.mockResolvedValue(project());
    h.taskFindUnique.mockResolvedValue(task());
    const res = await PATCH(req({ acceptanceCriteria: '- [ ] hace X', techDesign: '## Diseño' }), ctx());
    expect(res.status).toBe(200);
    const data = h.taskUpdate.mock.calls[0]![0].data;
    expect(data.acceptanceCriteria).toBe('- [ ] hace X');
    expect(data.techDesign).toBe('## Diseño');
    expect(data.techDesignAt).toBeInstanceOf(Date);
  });
  it('200 moves to DONE and fires brain extractor', async () => {
    h.projectFindUnique.mockResolvedValue(project());
    h.taskFindUnique.mockResolvedValue(task());
    h.extract.mockResolvedValue({ ok: true });
    const res = await PATCH(req({ toState: 'Done' }), ctx());
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.extract).toHaveBeenCalledWith('proj', 't1', 'u1');
  });
  it('200 swallows brain extractor errors', async () => {
    h.projectFindUnique.mockResolvedValue(project());
    h.taskFindUnique.mockResolvedValue(task());
    h.extract.mockRejectedValue(new Error('boom'));
    const res = await PATCH(req({ toState: 'Done' }), ctx());
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
  });

  it('403 guardrail: an agent cannot approve its own work (audited, no mutation)', async () => {
    h.projectFindUnique.mockResolvedValue(project());
    h.taskFindUnique.mockResolvedValue(task({ qaHandoff: { submittedById: 'u1' } }));
    h.blockReason.mockResolvedValue('guardrail: el agente DEV no puede aprobar su propio trabajo (desarrolló esta HU)');
    const res = await PATCH(req({ toState: 'Done' }), ctx());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('guardrail');
    expect(h.blockReason).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', actorUserId: 'u1', qaHandoff: { submittedById: 'u1' } }),
    );
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'task.self_approval_blocked' }));
    expect(h.publishEvent).not.toHaveBeenCalled();
  });

  it('guardrail only consults on transitions INTO done', async () => {
    h.projectFindUnique.mockResolvedValue(project());
    h.taskFindUnique.mockResolvedValue(task());
    await PATCH(req({ title: 'solo titulo' }), ctx());
    expect(h.blockReason).not.toHaveBeenCalled();
  });

  it('asigna al agente del rol pedido (resuelto server-side) y registra ASSIGNED', async () => {
    h.projectFindUnique.mockResolvedValue(project());
    h.taskFindUnique.mockResolvedValue(task());
    h.agentFindUnique.mockResolvedValue({ userId: 'u-dev-agent', enabled: true });
    const res = await PATCH(req({ assignToAgentRole: 'DEV' }), ctx());
    expect(res.status).toBe(200);
    expect(h.agentFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId_role: { projectId: 'p1', role: 'DEV' } } }),
    );
    expect(h.taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assigneeId: 'u-dev-agent' }) }),
    );
    expect(h.activityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'ASSIGNED' }) }),
    );
  });

  it('400 si el proyecto no tiene agente de ese rol; 409 si está disabled', async () => {
    h.projectFindUnique.mockResolvedValue(project());
    h.taskFindUnique.mockResolvedValue(task());
    h.agentFindUnique.mockResolvedValue(null);
    expect((await PATCH(req({ assignToAgentRole: 'QA' }), ctx())).status).toBe(400);
    h.agentFindUnique.mockResolvedValue({ userId: 'x', enabled: false });
    expect((await PATCH(req({ assignToAgentRole: 'QA' }), ctx())).status).toBe(409);
  });

  it('emits story.state_changed on a state transition', async () => {
    h.projectFindUnique.mockResolvedValue(project());
    h.taskFindUnique.mockResolvedValue(task());
    h.extract.mockResolvedValue({ ok: true });
    await PATCH(req({ toState: 'Done' }), ctx());
    expect(h.publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'story.state_changed',
        fromState: expect.objectContaining({ id: 's1' }),
        toState: expect.objectContaining({ id: 's2', category: 'DONE' }),
      }),
    );
  });
});
