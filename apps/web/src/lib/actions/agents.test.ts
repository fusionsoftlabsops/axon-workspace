import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, assertMock, auditMock, provisionMock, revalidateMock } = vi.hoisted(() => ({
  prismaMock: {
    agent: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    agentRun: { findMany: vi.fn() },
    auditLog: { count: vi.fn() },
  },
  assertMock: vi.fn(),
  auditMock: vi.fn(),
  provisionMock: vi.fn(),
  revalidateMock: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: assertMock }));
vi.mock('@/lib/agents/provision', () => ({
  provisionAgent: provisionMock,
  AGENT_DISPLAY_NAMES: { SM: 'Agente Scrum Master', DEV: 'Agente Dev', QA: 'Agente QA' },
}));

import {
  listAgentsAction,
  provisionAgentAction,
  setAgentEnabledAction,
  updateAgentAction,
  listAgentRunsAction,
  getAgentStatsAction,
} from './agents';

const OWNER = { ok: true as const, userId: 'u1', projectId: 'p1', role: 'OWNER' as const };
const AGENT_ROW = {
  id: 'ag1',
  role: 'DEV',
  llmModel: 'qwen3-coder-next',
  credentialRef: null,
  tokenBudget: 200000,
  enabled: false,
  apiToken: { prefix: 'ad_pk_abc123' },
  createdAt: new Date('2026-07-03T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  assertMock.mockResolvedValue(OWNER);
  prismaMock.agent.findMany.mockResolvedValue([AGENT_ROW]);
  provisionMock.mockResolvedValue({ agentId: 'ag1', userId: 'au1', tokenId: 't1', tokenPlain: 'ad_pk_PLAIN', tokenPrefix: 'ad_pk_PLAIN'.slice(0, 12) });
});

describe('listAgentsAction', () => {
  it('maps agents with display name and token prefix', async () => {
    const res = await listAgentsAction('axon');
    expect(res.ok && res.data[0]).toMatchObject({
      id: 'ag1',
      role: 'DEV',
      displayName: 'Agente Dev',
      tokenPrefix: 'ad_pk_abc123',
      enabled: false,
    });
  });

  it('propagates the membership error', async () => {
    assertMock.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await listAgentsAction('axon')).toEqual({ ok: false, error: 'nope' });
  });
});

describe('provisionAgentAction', () => {
  it('rejects non OWNER/ADMIN', async () => {
    assertMock.mockResolvedValue({ ...OWNER, role: 'MEMBER' });
    const res = await provisionAgentAction('axon', { role: 'DEV', llmModel: 'm' });
    expect(res).toEqual({ ok: false, error: 'Solo OWNER/ADMIN pueden gestionar agentes' });
  });

  it('rejects an invalid role / empty model / tiny budget', async () => {
    expect(await provisionAgentAction('axon', { role: 'PO' as never, llmModel: 'm' })).toMatchObject({ ok: false });
    expect(await provisionAgentAction('axon', { role: 'DEV', llmModel: '  ' })).toMatchObject({ ok: false });
    expect(await provisionAgentAction('axon', { role: 'DEV', llmModel: 'm', tokenBudget: 10 })).toMatchObject({ ok: false });
  });

  it('provisions, audits and returns the plain token once', async () => {
    const res = await provisionAgentAction('axon', { role: 'DEV', llmModel: ' qwen3-coder-next ', credentialRef: null });
    expect(provisionMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', projectSlug: 'axon', role: 'DEV', llmModel: 'qwen3-coder-next' }),
    );
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'agent.provision' }));
    expect(res.ok && res.data.tokenPlain).toBe('ad_pk_PLAIN');
  });

  it('surfaces provisioning errors (duplicate role)', async () => {
    provisionMock.mockRejectedValue(new Error('ya tiene un agente DEV'));
    expect(await provisionAgentAction('axon', { role: 'DEV', llmModel: 'm' })).toEqual({
      ok: false,
      error: 'ya tiene un agente DEV',
    });
  });
});

describe('updateAgentAction', () => {
  it('valida modelo/presupuesto y actualiza con auditoría', async () => {
    prismaMock.agent.findFirst.mockResolvedValue({ id: 'ag1' });
    prismaMock.agent.update.mockResolvedValue({});
    expect(await updateAgentAction('axon', 'ag1', { llmModel: '  ' })).toMatchObject({ ok: false });
    expect(await updateAgentAction('axon', 'ag1', { tokenBudget: 10 })).toMatchObject({ ok: false });
    const res = await updateAgentAction('axon', 'ag1', { llmModel: ' m2 ', tokenBudget: 5000 });
    expect(prismaMock.agent.update).toHaveBeenCalledWith({
      where: { id: 'ag1' },
      data: { llmModel: 'm2', tokenBudget: 5000 },
    });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'agent.update' }));
    expect(res.ok).toBe(true);
  });

  it('rechaza agentes de otro proyecto', async () => {
    prismaMock.agent.findFirst.mockResolvedValue(null);
    expect(await updateAgentAction('axon', 'agX', { tokenBudget: 5000 })).toEqual({
      ok: false,
      error: 'Agente no encontrado',
    });
  });
});

describe('listAgentRunsAction', () => {
  it('mapea la bitácora con rol, HU y costo como string', async () => {
    prismaMock.agentRun.findMany.mockResolvedValue([
      {
        id: 'r1',
        status: 'SUCCEEDED',
        promptTokens: 100,
        completionTokens: 50,
        costUsd: { toString: () => '0.012' },
        error: null,
        startedAt: new Date('2026-07-03T10:00:00Z'),
        finishedAt: new Date('2026-07-03T10:01:00Z'),
        agent: { role: 'DEV' },
        story: { taskNumber: 13, title: 'HU 13' },
      },
    ]);
    const res = await listAgentRunsAction('axon');
    expect(res.ok && res.data[0]).toMatchObject({
      role: 'DEV',
      storyNumber: 13,
      costUsd: '0.012',
      startedAt: '2026-07-03T10:00:00.000Z',
    });
  });
});

describe('getAgentStatsAction', () => {
  it('agrega por rol (éxitos, cortes, tokens, costo) y cuenta rechazos de QA', async () => {
    const run = (role: string, status: string, cost: string) => ({
      status,
      promptTokens: 100,
      completionTokens: 50,
      costUsd: { toString: () => cost },
      agent: { role },
    });
    prismaMock.agentRun.findMany.mockResolvedValue([
      run('DEV', 'SUCCEEDED', '0'),
      run('DEV', 'BUDGET_EXCEEDED', '0'),
      run('QA', 'SUCCEEDED', '0.02'),
      run('QA', 'FAILED', '0.01'),
      run('SM', 'RUNNING', '0'),
    ]);
    prismaMock.auditLog.count.mockResolvedValue(3);
    const res = await getAgentStatsAction('axon');
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) return;
    const dev = res.data.byRole.find((r) => r.role === 'DEV')!;
    expect(dev).toMatchObject({ total: 2, succeeded: 1, budgetExceeded: 1, promptTokens: 200 });
    const qa = res.data.byRole.find((r) => r.role === 'QA')!;
    expect(qa).toMatchObject({ total: 2, succeeded: 1, failed: 1, costUsd: '0.030000' });
    const sm = res.data.byRole.find((r) => r.role === 'SM')!;
    expect(sm).toMatchObject({ running: 1 });
    expect(res.data.qaRejections).toBe(3);
    expect(res.data.totalCostUsd).toBe('0.030000');
    expect(prismaMock.auditLog.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ action: 'task.qa_decision', payload: { path: ['decision'], equals: 'reject' } }),
      }),
    );
  });
});

describe('setAgentEnabledAction', () => {
  it('rejects an agent from another project', async () => {
    prismaMock.agent.findFirst.mockResolvedValue(null);
    expect(await setAgentEnabledAction('axon', 'agX', true)).toEqual({ ok: false, error: 'Agente no encontrado' });
  });

  it('toggles enabled and audits', async () => {
    prismaMock.agent.findFirst.mockResolvedValue({ id: 'ag1' });
    prismaMock.agent.update.mockResolvedValue({});
    const res = await setAgentEnabledAction('axon', 'ag1', true);
    expect(prismaMock.agent.update).toHaveBeenCalledWith({ where: { id: 'ag1' }, data: { enabled: true } });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'agent.update' }));
    expect(res.ok).toBe(true);
  });
});
