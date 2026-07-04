import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  runtimeFindMany: vi.fn(),
  agentFindMany: vi.fn(),
  openAgentToken: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ requireApiToken: h.requireApiToken }));
vi.mock('@/lib/db', () => ({
  prisma: { agentRuntimeToken: { findMany: h.runtimeFindMany }, agent: { findMany: h.agentFindMany } },
}));
vi.mock('@/lib/agents/runtime-tokens', () => ({ openAgentToken: h.openAgentToken }));

import { GET } from './route';

const req = () => new NextRequest('http://localhost/api/v1/internal/agent-runtime');

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireApiToken.mockResolvedValue({ userId: 'svc', scopes: ['agents:runtime'], projectSlugs: [] });
  h.openAgentToken.mockImplementation((r: { sealed: Buffer }) => `plain-${r.sealed.toString()}`);
});

describe('GET /internal/agent-runtime', () => {
  it('exige el scope agents:runtime', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({ error: 'missing scope' }, { status: 403 }));
    expect((await GET(req())).status).toBe(403);
  });

  it('agrupa por proyecto y devuelve el token desellado + enabled/llmModel', async () => {
    h.runtimeFindMany.mockResolvedValue([
      { projectId: 'p1', role: 'QA', sealed: Buffer.from('qa'), nonce: Buffer.alloc(24), project: { id: 'p1', slug: 'axon' } },
      { projectId: 'p1', role: 'DEV', sealed: Buffer.from('dev'), nonce: Buffer.alloc(24), project: { id: 'p1', slug: 'axon' } },
      { projectId: 'p2', role: 'SM', sealed: Buffer.from('sm'), nonce: Buffer.alloc(24), project: { id: 'p2', slug: 'forgeia' } },
    ]);
    h.agentFindMany.mockResolvedValue([
      { projectId: 'p1', role: 'QA', enabled: true, llmModel: 'claude-opus-4-8', tokenBudget: 500000 },
      { projectId: 'p1', role: 'DEV', enabled: false, llmModel: 'qwen3-coder-next', tokenBudget: 200000 },
      { projectId: 'p2', role: 'SM', enabled: true, llmModel: 'claude-sonnet-5', tokenBudget: 300000 },
    ]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toHaveLength(2);
    const axon = body.projects.find((p: { slug: string }) => p.slug === 'axon');
    expect(axon.agents).toHaveLength(2);
    const qa = axon.agents.find((a: { role: string }) => a.role === 'QA');
    expect(qa).toMatchObject({ enabled: true, llmModel: 'claude-opus-4-8', token: 'plain-qa' });
  });

  it('ignora tokens huérfanos (sin fila Agent)', async () => {
    h.runtimeFindMany.mockResolvedValue([
      { projectId: 'p1', role: 'QA', sealed: Buffer.from('qa'), nonce: Buffer.alloc(24), project: { id: 'p1', slug: 'axon' } },
    ]);
    h.agentFindMany.mockResolvedValue([]); // agente borrado
    const body = await (await GET(req())).json();
    expect(body.projects).toEqual([]);
  });
});
