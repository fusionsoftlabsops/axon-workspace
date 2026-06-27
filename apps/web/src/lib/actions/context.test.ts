import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  prismaMock,
  assertMock,
  langMock,
  isInfraMock,
  infraModelMock,
  buildGraphMock,
  focusMock,
  signatureMock,
  summarizeMock,
} = vi.hoisted(() => ({
  prismaMock: { contextSummary: { findUnique: vi.fn(), upsert: vi.fn() } },
  assertMock: vi.fn(),
  langMock: vi.fn(),
  isInfraMock: vi.fn(),
  infraModelMock: vi.fn(),
  buildGraphMock: vi.fn(),
  focusMock: vi.fn(),
  signatureMock: vi.fn(),
  summarizeMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: assertMock }));
vi.mock('@/lib/i18n/server', () => ({ getServerLang: langMock }));
vi.mock('@/lib/ai/infra-llm', () => ({ isInfraLlmConfigured: isInfraMock, infraModelName: infraModelMock }));
vi.mock('@/lib/graph/build', () => ({
  buildProjectGraph: buildGraphMock,
  focusSubgraph: focusMock,
  graphSignature: signatureMock,
}));
vi.mock('@/lib/graph/summary', () => ({ summarizeGraph: summarizeMock }));

import {
  getContextGraphAction,
  getContextSummaryAction,
  generateContextSummaryAction,
} from './context';

const okCtx = { ok: true, userId: 'u1', projectId: 'p1', role: 'OWNER' as const };
const fullGraph = { nodes: [{ id: 'a' }], links: [] };

beforeEach(() => {
  vi.clearAllMocks();
  assertMock.mockResolvedValue(okCtx);
  langMock.mockResolvedValue('es');
  isInfraMock.mockReturnValue(true);
  infraModelMock.mockReturnValue('infra-model');
  buildGraphMock.mockResolvedValue(fullGraph);
  signatureMock.mockReturnValue('sig');
  focusMock.mockReturnValue({ nodes: [{ id: 'a' }], links: [] });
});

describe('getContextGraphAction', () => {
  it('propagates the membership error', async () => {
    assertMock.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await getContextGraphAction('slug')).toEqual({ ok: false, error: 'nope' });
  });

  it('returns the built graph', async () => {
    const res = await getContextGraphAction('slug');
    expect(res).toEqual({ ok: true, data: { graph: fullGraph } });
  });
});

describe('getContextSummaryAction', () => {
  it('propagates the membership error', async () => {
    assertMock.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await getContextSummaryAction('slug', 'PROJECT', 'r')).toEqual({ ok: false, error: 'nope' });
  });

  it('returns a PROJECT summary view from the cached row', async () => {
    prismaMock.contextSummary.findUnique.mockResolvedValue({
      body: 'B',
      model: 'm',
      updatedAt: new Date('2020-01-01T00:00:00Z'),
      signature: 'sig',
    });
    const res = await getContextSummaryAction('slug', 'PROJECT', 'ignored');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.body).toBe('B');
      expect(res.data.stale).toBe(false);
      expect(res.data.refId).toBe('p1');
    }
  });

  it('marks the view stale when signatures differ and has no row', async () => {
    prismaMock.contextSummary.findUnique.mockResolvedValue(null);
    const res = await getContextSummaryAction('slug', 'PROJECT', 'r');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.body).toBeNull();
  });

  it('returns "Nodo no encontrado" when the TASK subgraph is empty', async () => {
    focusMock.mockReturnValue({ nodes: [], links: [] });
    const res = await getContextSummaryAction('slug', 'TASK', 'task-1');
    expect(res).toEqual({ ok: false, error: 'Nodo no encontrado' });
  });
});

describe('generateContextSummaryAction', () => {
  it('propagates the membership error', async () => {
    assertMock.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await generateContextSummaryAction('slug', 'PROJECT', 'r')).toEqual({
      ok: false,
      error: 'nope',
    });
  });

  it('rejects when the infra model is not configured', async () => {
    isInfraMock.mockReturnValue(false);
    const res = await generateContextSummaryAction('slug', 'PROJECT', 'r');
    expect(res.ok).toBe(false);
  });

  it('returns "Nodo no encontrado" when the subgraph is empty', async () => {
    focusMock.mockReturnValue({ nodes: [], links: [] });
    const res = await generateContextSummaryAction('slug', 'TASK', 'task-1');
    expect(res).toEqual({ ok: false, error: 'Nodo no encontrado' });
  });

  it('returns the model error when summarizeGraph throws', async () => {
    summarizeMock.mockRejectedValue(new Error('model down'));
    const res = await generateContextSummaryAction('slug', 'PROJECT', 'r');
    expect(res).toEqual({ ok: false, error: 'model down' });
  });

  it('generates, upserts and returns the view', async () => {
    summarizeMock.mockResolvedValue('SUMMARY');
    prismaMock.contextSummary.findUnique.mockResolvedValue({
      body: 'SUMMARY',
      model: 'infra-model',
      updatedAt: new Date('2020-01-01T00:00:00Z'),
      signature: 'sig',
    });
    const res = await generateContextSummaryAction('slug', 'PROJECT', 'r');
    expect(prismaMock.contextSummary.upsert).toHaveBeenCalled();
    expect(res).toMatchObject({ ok: true, data: { body: 'SUMMARY', model: 'infra-model' } });
  });
});
