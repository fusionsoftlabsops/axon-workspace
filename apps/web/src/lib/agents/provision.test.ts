import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, txMock } = vi.hoisted(() => {
  const txMock = {
    user: { upsert: vi.fn() },
    projectMember: { upsert: vi.fn() },
    apiToken: { create: vi.fn() },
    agent: { create: vi.fn() },
  };
  return {
    txMock,
    prismaMock: {
      agent: { findUnique: vi.fn(), findFirst: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: typeof txMock) => unknown) => fn(txMock)),
    },
  };
});

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
// El sellado del token de runtime tiene su propio test; acá lo neutralizamos.
vi.mock('@/lib/agents/runtime-tokens', () => ({ sealAgentToken: vi.fn(), openAgentToken: vi.fn() }));

import {
  agentEmail,
  ensureAgentUser,
  provisionAgent,
  selfApprovalBlockReason,
  AGENT_TOKEN_SCOPES,
} from './provision';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof txMock) => unknown) => fn(txMock));
  prismaMock.agent.findUnique.mockResolvedValue(null);
  txMock.user.upsert.mockResolvedValue({ id: 'agent-user' });
  txMock.projectMember.upsert.mockResolvedValue({});
  txMock.apiToken.create.mockResolvedValue({ id: 'tok1' });
  txMock.agent.create.mockResolvedValue({ id: 'ag1' });
});

describe('agentEmail / ensureAgentUser', () => {
  it('derives a stable service email per role', () => {
    expect(agentEmail('DEV')).toBe('agent-dev@agents.axon.local');
    expect(agentEmail('SM')).toBe('agent-sm@agents.axon.local');
  });

  it('upserts the service user with disabled login and dummy key material', async () => {
    await ensureAgentUser(txMock as never, 'QA');
    const arg = txMock.user.upsert.mock.calls[0]![0];
    expect(arg.where).toEqual({ email: 'agent-qa@agents.axon.local' });
    expect(arg.create.passwordHash).toContain('disabled');
    expect(arg.update).toEqual({});
  });
});

describe('provisionAgent', () => {
  const OPTS = { projectId: 'p1', projectSlug: 'axon', role: 'DEV' as const, llmModel: 'qwen3-coder-next' };

  it('rejects when the project already has an agent for that role', async () => {
    prismaMock.agent.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(provisionAgent(OPTS)).rejects.toThrow('ya tiene un agente DEV');
  });

  it('creates user + membership + scoped token + agent, returning the plain token once', async () => {
    const out = await provisionAgent({ ...OPTS, tokenBudget: 50000 });
    expect(out).toMatchObject({ agentId: 'ag1', userId: 'agent-user', tokenId: 'tok1' });
    expect(out.tokenPlain).toMatch(/^ad_pk_/);
    expect(out.tokenPrefix).toBe(out.tokenPlain.slice(0, 12));

    const memberArg = txMock.projectMember.upsert.mock.calls[0]![0];
    expect(memberArg.create).toEqual({ projectId: 'p1', userId: 'agent-user', role: 'MEMBER' });

    const tokenArg = txMock.apiToken.create.mock.calls[0]![0];
    expect(tokenArg.data.name).toBe('agent:dev:axon');
    expect(tokenArg.data.projectSlugs).toEqual(['axon']);
    expect(tokenArg.data.scopes).toEqual([...AGENT_TOKEN_SCOPES]);
    expect(tokenArg.data.tokenHash).toHaveLength(64);
    expect(JSON.stringify(tokenArg)).not.toContain(out.tokenPlain);

    const agentArg = txMock.agent.create.mock.calls[0]![0];
    expect(agentArg.data).toMatchObject({
      projectId: 'p1',
      role: 'DEV',
      userId: 'agent-user',
      apiTokenId: 'tok1',
      llmModel: 'qwen3-coder-next',
      tokenBudget: 50000,
    });
  });

  it('omits tokenBudget so the schema default applies', async () => {
    await provisionAgent(OPTS);
    expect(txMock.agent.create.mock.calls[0]![0].data).not.toHaveProperty('tokenBudget');
  });
});

describe('selfApprovalBlockReason', () => {
  const BASE = { projectId: 'p1', actorUserId: 'u-dev', assigneeId: null, qaHandoff: null };

  it('allows humans (actor is not an agent)', async () => {
    prismaMock.agent.findFirst.mockResolvedValue(null);
    expect(await selfApprovalBlockReason(BASE)).toBeNull();
  });

  it('blocks the agent that submitted the qa handoff', async () => {
    prismaMock.agent.findFirst.mockResolvedValue({ id: 'ag1', role: 'DEV' });
    const reason = await selfApprovalBlockReason({ ...BASE, qaHandoff: { submittedById: 'u-dev' } });
    expect(reason).toContain('no puede aprobar su propio trabajo');
  });

  it('blocks the agent that is the assignee (fallback when no handoff)', async () => {
    prismaMock.agent.findFirst.mockResolvedValue({ id: 'ag1', role: 'QA' });
    const reason = await selfApprovalBlockReason({ ...BASE, assigneeId: 'u-dev' });
    expect(reason).toContain('QA');
  });

  it('allows an agent approving work developed by a DIFFERENT identity', async () => {
    prismaMock.agent.findFirst.mockResolvedValue({ id: 'ag2', role: 'QA' });
    const reason = await selfApprovalBlockReason({
      ...BASE,
      actorUserId: 'u-qa',
      qaHandoff: { submittedById: 'u-dev' },
      assigneeId: 'u-dev',
    });
    expect(reason).toBeNull();
  });

  it('allows an agent when the story has no recorded developer', async () => {
    prismaMock.agent.findFirst.mockResolvedValue({ id: 'ag1', role: 'SM' });
    expect(await selfApprovalBlockReason(BASE)).toBeNull();
  });
});
