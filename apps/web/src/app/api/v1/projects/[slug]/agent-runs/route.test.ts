import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  agentFindFirst: vi.fn(),
  taskFindFirst: vi.fn(),
  runCreate: vi.fn(),
  runFindUnique: vi.fn(),
  runUpdate: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireApiToken: h.requireApiToken,
  tokenAllowsProject: (a: { projectSlugs: string[] }, s: string) =>
    a.projectSlugs.length === 0 || a.projectSlugs.includes(s),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    project: { findUnique: h.projectFindUnique },
    agent: { findFirst: h.agentFindFirst },
    task: { findFirst: h.taskFindFirst },
    agentRun: { create: h.runCreate, findUnique: h.runFindUnique, update: h.runUpdate },
  },
}));

import { POST } from './route';
import { PATCH } from './[runId]/route';
import { GET as GET_ME } from '../agents/me/route';

const authd = { userId: 'u-agent', tokenId: 't1', scopes: [], projectSlugs: [] as string[] };
const postCtx = { params: Promise.resolve({ slug: 'axon' }) };
const patchCtx = { params: Promise.resolve({ slug: 'axon', runId: 'r1' }) };

function req(body?: unknown, method = 'POST') {
  return new NextRequest('http://localhost/x', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireApiToken.mockResolvedValue({ ...authd });
  h.projectFindUnique.mockResolvedValue({ id: 'p1' });
  h.agentFindFirst.mockResolvedValue({ id: 'ag1', enabled: true, tokenBudget: 200000 });
  h.runCreate.mockResolvedValue({ id: 'r1', startedAt: new Date('2026-07-03T00:00:00Z') });
});

describe('GET agents/me', () => {
  it('devuelve la config del agente del token', async () => {
    h.agentFindFirst.mockResolvedValue({ id: 'ag1', role: 'DEV', llmModel: 'qwen', tokenBudget: 5, enabled: true });
    const res = await GET_ME(req(undefined, 'GET'), postCtx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: 'DEV', tokenBudget: 5 });
  });

  it('404 cuando el token no pertenece a un agente', async () => {
    h.agentFindFirst.mockResolvedValue(null);
    const res = await GET_ME(req(undefined, 'GET'), postCtx);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('not an agent');
  });
});

describe('POST agent-runs', () => {
  it('401 cuando la auth falla', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await POST(req({}), postCtx)).status).toBe(401);
  });

  it('403 cuando el agente está deshabilitado (kill-switch)', async () => {
    h.agentFindFirst.mockResolvedValue({ id: 'ag1', enabled: false, tokenBudget: 1 });
    const res = await POST(req({}), postCtx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('disabled');
  });

  it('400 cuando la story no es del proyecto', async () => {
    h.taskFindFirst.mockResolvedValue(null);
    const res = await POST(req({ storyId: 'ajena' }), postCtx);
    expect(res.status).toBe(400);
  });

  it('201 crea el run y devuelve el presupuesto del Agent', async () => {
    h.taskFindFirst.mockResolvedValue({ id: 'story1' });
    const res = await POST(req({ storyId: 'story1', payload: { via: 'evento' } }), postCtx);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: 'r1', tokenBudget: 200000 });
    expect(h.runCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ agentId: 'ag1', storyId: 'story1' }) }),
    );
  });
});

describe('PATCH agent-runs/:id', () => {
  const RUN = { id: 'r1', status: 'RUNNING', agent: { projectId: 'p1', userId: 'u-agent' } };

  it('404 run de otro proyecto', async () => {
    h.runFindUnique.mockResolvedValue({ ...RUN, agent: { ...RUN.agent, projectId: 'other' } });
    expect((await PATCH(req({ status: 'SUCCEEDED' }, 'PATCH'), patchCtx)).status).toBe(404);
  });

  it('403 run de otro agente', async () => {
    h.runFindUnique.mockResolvedValue({ ...RUN, agent: { ...RUN.agent, userId: 'otro' } });
    expect((await PATCH(req({ status: 'SUCCEEDED' }, 'PATCH'), patchCtx)).status).toBe(403);
  });

  it('409 run ya cerrado', async () => {
    h.runFindUnique.mockResolvedValue({ ...RUN, status: 'SUCCEEDED' });
    expect((await PATCH(req({ status: 'FAILED' }, 'PATCH'), patchCtx)).status).toBe(409);
  });

  it('200 cierra con estado terminal, tokens y costo', async () => {
    h.runFindUnique.mockResolvedValue(RUN);
    h.runUpdate.mockResolvedValue({});
    const res = await PATCH(
      req({ status: 'BUDGET_EXCEEDED', promptTokens: 900, completionTokens: 300, costUsd: 0.012, error: 'corte' }, 'PATCH'),
      patchCtx,
    );
    expect(res.status).toBe(200);
    expect(h.runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'BUDGET_EXCEEDED',
          promptTokens: 900,
          completionTokens: 300,
          costUsd: 0.012,
          error: 'corte',
          finishedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('400 body inválido', async () => {
    h.runFindUnique.mockResolvedValue(RUN);
    expect((await PATCH(req({ status: 'NOPE' }, 'PATCH'), patchCtx)).status).toBe(400);
  });
});
