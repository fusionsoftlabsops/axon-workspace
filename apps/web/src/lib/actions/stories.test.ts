import { describe, it, expect, vi, beforeEach } from 'vitest';

const CUID = 'cjld2cjxh0000qzrmn831i7rn';

const {
  prismaMock,
  txMock,
  authMock,
  auditMock,
  assertMock,
  revalidateMock,
  decryptMock,
  touchMock,
  getProviderMock,
  searchMock,
  repoReaderMock,
  buildPromptMock,
  tolerantParseMock,
  treeOutlineMock,
  storyOutputSchemaMock,
} = vi.hoisted(() => {
  const txMock = {
    projectTaskCounter: { upsert: vi.fn() },
    task: { create: vi.fn() },
    taskActivity: { create: vi.fn() },
    storyDraft: { update: vi.fn() },
  };
  return {
    txMock,
    prismaMock: {
      llmCredential: { findUnique: vi.fn(), findFirst: vi.fn() },
      storyDraft: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      brainMemory: { findMany: vi.fn(), updateMany: vi.fn() },
      aiInteraction: { create: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: typeof txMock) => unknown) => fn(txMock)),
    },
    authMock: vi.fn(),
    auditMock: vi.fn(),
    assertMock: vi.fn(),
    revalidateMock: vi.fn(),
    decryptMock: vi.fn(),
    touchMock: vi.fn(),
    getProviderMock: vi.fn(),
    searchMock: vi.fn(),
    repoReaderMock: vi.fn(),
    buildPromptMock: vi.fn(),
    tolerantParseMock: vi.fn(),
    treeOutlineMock: vi.fn(),
    storyOutputSchemaMock: { safeParse: vi.fn() },
  };
});

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: assertMock }));
vi.mock('@/lib/llm-credentials/store', () => ({
  decryptLlmCredentialKey: decryptMock,
  touchLlmCredential: touchMock,
}));
vi.mock('@/lib/ai/providers/registry', () => ({ getProvider: getProviderMock }));
vi.mock('@/lib/brain/search', () => ({ searchBrain: searchMock }));
vi.mock('@/lib/repo/reader', () => ({ repoReaderFor: repoReaderMock }));
const envMock = vi.hoisted(() =>
  vi.fn((): { ANTHROPIC_API_KEY: string | undefined } => ({ ANTHROPIC_API_KEY: 'sk-ant-test' })),
);
vi.mock('@/lib/env', () => ({ env: envMock }));
vi.mock('@/lib/ai/story-prompt', () => ({
  buildStoryPrompt: buildPromptMock,
  storyOutputSchema: storyOutputSchemaMock,
  STORY_OUTPUT_JSON_SCHEMA: {},
  tolerantParse: tolerantParseMock,
  treeOutline: treeOutlineMock,
}));

import {
  startStoryDraftAction,
  runDraftGeneration,
  publishStoryDraftAsTaskAction,
  regenerateDraftAction,
} from './stories';

const okCtx = { ok: true, userId: 'u1', projectId: 'p1', role: 'OWNER' as const };

const STORY_OUTPUT = {
  summary: 'Line one\nrest',
  acceptanceCriteria: 'A',
  technicalContext: 'T',
  subtaskBreakdown: [{ title: 'Sub 1', description: 'd', priority: 'MEDIUM' }],
  filesToTouch: [{ path: 'src/x.ts', reason: 'r' }],
  risks: 'R',
};

function streamOf(chunks: unknown[]) {
  return async function* () {
    for (const c of chunks) yield c;
  };
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const baseDraft = {
  id: 'd1',
  authorId: 'u1',
  status: 'GENERATING',
  provider: 'ANTHROPIC',
  projectId: 'p1',
  rawInput: 'a meaningful raw input',
  model: 'model-x',
  citedMemoryIds: [],
  selectedPaths: [],
  project: { id: 'p1', slug: 's', name: 'N', repoPath: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof txMock) => unknown) => fn(txMock));
  assertMock.mockResolvedValue(okCtx);
  authMock.mockResolvedValue({ user: { id: 'u1' } });
  decryptMock.mockReturnValue('api-key');
  buildPromptMock.mockReturnValue([{ role: 'user', content: 'x' }]);
  treeOutlineMock.mockReturnValue('TREE');
  tolerantParseMock.mockReturnValue(STORY_OUTPUT);
  storyOutputSchemaMock.safeParse.mockReturnValue({ success: true, data: STORY_OUTPUT });
  repoReaderMock.mockResolvedValue(null);
  searchMock.mockResolvedValue([]);
  prismaMock.storyDraft.findUnique.mockResolvedValue(null);
  prismaMock.storyDraft.create.mockResolvedValue({ id: 'd1' });
  prismaMock.storyDraft.update.mockResolvedValue({});
  prismaMock.aiInteraction.create.mockResolvedValue({});
  prismaMock.brainMemory.findMany.mockResolvedValue([]);
  prismaMock.brainMemory.updateMany.mockResolvedValue({});
  prismaMock.llmCredential.findUnique.mockResolvedValue({ userId: 'u1', projectId: null, provider: 'ANTHROPIC', revokedAt: null });
  prismaMock.llmCredential.findFirst.mockResolvedValue({ id: 'cred1', provider: 'ANTHROPIC' });
  getProviderMock.mockReturnValue({
    chatStream: vi.fn(() => streamOf([{ delta: '{"summary":"S"}' }, { usage: { inputTokens: 10, outputTokens: 20 } }])()),
    estimateCost: vi.fn(() => 0.01),
  });
});

describe('startStoryDraftAction', () => {
  const input = {
    rawInput: 'a meaningful raw input',
    provider: 'ANTHROPIC' as const,
    model: 'model-x',
    credentialId: CUID,
    selectedPaths: [],
    citedMemoryIds: [],
  };

  it('propagates the membership error', async () => {
    assertMock.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await startStoryDraftAction('slug', input)).toEqual({ ok: false, error: 'nope' });
  });

  it('rejects a VIEWER', async () => {
    assertMock.mockResolvedValue({ ...okCtx, role: 'VIEWER' });
    const res = await startStoryDraftAction('slug', input);
    expect(res.ok).toBe(false);
  });

  it('rejects invalid input', async () => {
    const res = await startStoryDraftAction('slug', { ...input, rawInput: 'short' });
    expect(res).toEqual({ ok: false, error: 'Datos inválidos' });
  });

  it('accepts the synthetic server credential when the env key exists', async () => {
    assertMock.mockResolvedValue(okCtx);
    envMock.mockReturnValue({ ANTHROPIC_API_KEY: 'sk-ant-test' });
    prismaMock.storyDraft.create.mockResolvedValue({ id: 'draft-1' });
    const res = await startStoryDraftAction('slug', { ...input, credentialId: 'server' });
    expect(res).toEqual({ ok: true, draftId: 'draft-1' });
    // No toca la tabla de credenciales personales.
    expect(prismaMock.llmCredential.findUnique).not.toHaveBeenCalled();
  });

  it('rejects the server credential when the env key is missing', async () => {
    assertMock.mockResolvedValue(okCtx);
    envMock.mockReturnValue({ ANTHROPIC_API_KEY: undefined });
    const res = await startStoryDraftAction('slug', { ...input, credentialId: 'server' });
    expect(res).toEqual({ ok: false, error: 'Credencial del servidor no disponible' });
  });

  it('rejects the server credential for non-Anthropic providers', async () => {
    assertMock.mockResolvedValue(okCtx);
    envMock.mockReturnValue({ ANTHROPIC_API_KEY: 'sk-ant-test' });
    const res = await startStoryDraftAction('slug', {
      ...input,
      provider: 'OPENAI' as const,
      credentialId: 'server',
    });
    expect(res).toEqual({ ok: false, error: 'Credencial del servidor no disponible' });
  });

  it('rejects an invalid credential', async () => {
    prismaMock.llmCredential.findUnique.mockResolvedValue(null);
    expect(await startStoryDraftAction('slug', input)).toEqual({ ok: false, error: 'Credencial no válida' });
  });

  it('rejects a credential from another project', async () => {
    prismaMock.llmCredential.findUnique.mockResolvedValue({ userId: 'u1', projectId: 'other', provider: 'ANTHROPIC', revokedAt: null });
    expect(await startStoryDraftAction('slug', input)).toEqual({ ok: false, error: 'Credencial es de otro proyecto' });
  });

  it('rejects a provider mismatch', async () => {
    prismaMock.llmCredential.findUnique.mockResolvedValue({ userId: 'u1', projectId: null, provider: 'OPENAI', revokedAt: null });
    expect(await startStoryDraftAction('slug', input)).toEqual({ ok: false, error: 'Provider no coincide con la credencial' });
  });

  it('creates the draft and returns its id', async () => {
    prismaMock.llmCredential.findUnique.mockResolvedValue({ userId: 'u1', projectId: null, provider: 'ANTHROPIC', revokedAt: null });
    prismaMock.storyDraft.create.mockResolvedValue({ id: 'd1' });
    const res = await startStoryDraftAction('slug', input);
    expect(prismaMock.storyDraft.create).toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'story.draft.start' }));
    expect(res).toEqual({ ok: true, draftId: 'd1' });
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe('runDraftGeneration', () => {
  it('errors when the draft is missing or not owned', async () => {
    prismaMock.storyDraft.findUnique.mockResolvedValue(null);
    const evs = await collect(runDraftGeneration('d1', 'u1'));
    expect(evs).toEqual([{ type: 'error', message: 'Draft no encontrado o sin permisos' }]);
  });

  it('errors when the draft is not in GENERATING state', async () => {
    prismaMock.storyDraft.findUnique.mockResolvedValue({ ...baseDraft, status: 'READY' });
    const evs = await collect(runDraftGeneration('d1', 'u1'));
    expect(evs[0]).toMatchObject({ type: 'error' });
  });

  it('errors when no LLM credential is available', async () => {
    envMock.mockReturnValue({ ANTHROPIC_API_KEY: undefined });
    prismaMock.storyDraft.findUnique.mockResolvedValue(baseDraft);
    prismaMock.llmCredential.findFirst.mockResolvedValue(null);
    const evs = await collect(runDraftGeneration('d1', 'u1'));
    expect(prismaMock.storyDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ERRORED' }) }),
    );
    expect(evs.at(-1)).toMatchObject({ type: 'error' });
  });

  it('streams sections and completes (searchBrain path, no repo)', async () => {
    prismaMock.storyDraft.findUnique.mockResolvedValue(baseDraft);
    searchMock.mockResolvedValue([{ id: 'm1', type: 'NOTE', title: 't', body: 'b', tags: [], rank: 0.9 }]);
    const evs = await collect(runDraftGeneration('d1', 'u1'));
    const types = evs.map((e) => e.type);
    expect(types).toContain('section');
    expect(types).toContain('usage');
    expect(evs.at(-1)).toMatchObject({ type: 'done' });
    expect(prismaMock.brainMemory.updateMany).toHaveBeenCalled();
    expect(touchMock).toHaveBeenCalledWith('cred1');
  });

  it('uses cited memories and a configured repo reader', async () => {
    prismaMock.storyDraft.findUnique.mockResolvedValue({
      ...baseDraft,
      citedMemoryIds: ['m1'],
      selectedPaths: ['src/x.ts'],
    });
    prismaMock.brainMemory.findMany.mockResolvedValue([{ id: 'm1', type: 'NOTE', title: 't', body: 'b', tags: [] }]);
    repoReaderMock.mockResolvedValue({
      tree: vi.fn().mockResolvedValue([]),
      readFiles: vi.fn().mockResolvedValue({ files: [{ path: 'src/x.ts', content: 'c' }], truncated: false }),
    });
    const evs = await collect(runDraftGeneration('d1', 'u1'));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'repo.read' }));
    expect(evs.at(-1)).toMatchObject({ type: 'done' });
  });

  it('retries once when the first attempt fails validation', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    prismaMock.storyDraft.findUnique.mockResolvedValue(baseDraft);
    storyOutputSchemaMock.safeParse
      .mockReturnValueOnce({ success: false, error: { issues: [{ message: 'bad' }] } })
      .mockReturnValue({ success: true, data: STORY_OUTPUT });
    const evs = await collect(runDraftGeneration('d1', 'u1'));
    expect(evs.at(-1)).toMatchObject({ type: 'done' });
    warnSpy.mockRestore();
  });

  it('errors after exhausting attempts, persisting ERRORED', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    prismaMock.storyDraft.findUnique.mockResolvedValue(baseDraft);
    storyOutputSchemaMock.safeParse.mockReturnValue({ success: false, error: { issues: [{ message: 'bad' }] } });
    const evs = await collect(runDraftGeneration('d1', 'u1'));
    expect(evs.at(-1)).toMatchObject({ type: 'error' });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'story.draft.error' }));
  });

  it('retries when the stream itself throws', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    prismaMock.storyDraft.findUnique.mockResolvedValue(baseDraft);
    const throwing = async function* () {
      yield { delta: '{' };
      throw new Error('stream broke');
    };
    getProviderMock.mockReturnValue({
      chatStream: vi
        .fn()
        .mockImplementationOnce(() => throwing())
        .mockImplementation(() => streamOf([{ delta: '{"summary":"S"}' }, { usage: { inputTokens: 1, outputTokens: 2 } }])()),
      estimateCost: vi.fn(() => 0.01),
    });
    const evs = await collect(runDraftGeneration('d1', 'u1'));
    expect(evs.at(-1)).toMatchObject({ type: 'done' });
  });
});

describe('publishStoryDraftAsTaskAction', () => {
  const input = { stateId: CUID, includeSubtasks: [0] };
  const readyDraft = {
    id: 'd1',
    projectId: 'p1',
    status: 'READY',
    summary: 'Title line\nmore',
    acceptanceCriteria: 'A',
    technicalContext: 'T',
    risks: 'R',
    filesToTouch: null,
    citedMemoryIds: [],
    subtaskBreakdown: [{ title: 'Sub', description: 'd', priority: 'HIGH' }],
    project: { id: 'p1', slug: 's', members: [{ role: 'OWNER' }], workflows: [{ states: [{ id: CUID }] }] },
  };

  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await publishStoryDraftAsTaskAction('d1', input)).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects invalid input', async () => {
    expect(await publishStoryDraftAsTaskAction('d1', { stateId: 'bad' } as never)).toEqual({ ok: false, error: 'Datos inválidos' });
  });

  it('rejects a missing draft', async () => {
    prismaMock.storyDraft.findUnique.mockResolvedValue(null);
    expect(await publishStoryDraftAsTaskAction('d1', input)).toEqual({ ok: false, error: 'Draft no encontrado' });
  });

  it('rejects when the user has no access', async () => {
    prismaMock.storyDraft.findUnique.mockResolvedValue({ ...readyDraft, project: { ...readyDraft.project, members: [] } });
    expect(await publishStoryDraftAsTaskAction('d1', input)).toEqual({ ok: false, error: 'Sin acceso al proyecto' });
  });

  it('rejects a draft that is not READY', async () => {
    prismaMock.storyDraft.findUnique.mockResolvedValue({ ...readyDraft, status: 'GENERATING' });
    expect(await publishStoryDraftAsTaskAction('d1', input)).toEqual({ ok: false, error: 'El draft no está listo' });
  });

  it('rejects a VIEWER', async () => {
    prismaMock.storyDraft.findUnique.mockResolvedValue({ ...readyDraft, project: { ...readyDraft.project, members: [{ role: 'VIEWER' }] } });
    expect(await publishStoryDraftAsTaskAction('d1', input)).toEqual({ ok: false, error: 'Sin permisos' });
  });

  it('rejects an unknown target state', async () => {
    prismaMock.storyDraft.findUnique.mockResolvedValue({
      ...readyDraft,
      project: { ...readyDraft.project, workflows: [{ states: [{ id: 'other' }] }] },
    });
    expect(await publishStoryDraftAsTaskAction('d1', input)).toEqual({ ok: false, error: 'Estado destino no encontrado' });
  });

  it('publishes the draft as a parent + subtasks', async () => {
    prismaMock.storyDraft.findUnique.mockResolvedValue(readyDraft);
    txMock.projectTaskCounter.upsert.mockResolvedValue({ next: 3 });
    txMock.task.create
      .mockResolvedValueOnce({ id: 'parent', taskNumber: 1 })
      .mockResolvedValue({ id: 'sub', taskNumber: 2 });
    const res = await publishStoryDraftAsTaskAction('d1', input);
    expect(txMock.task.create).toHaveBeenCalledTimes(2);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'story.publish' }));
    expect(res).toEqual({ ok: true, taskId: 'parent', taskNumber: 1 });
  });
});

describe('regenerateDraftAction', () => {
  const input = { draftId: CUID };

  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await regenerateDraftAction(input)).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects invalid input', async () => {
    expect(await regenerateDraftAction({ draftId: 'bad' } as never)).toEqual({ ok: false, error: 'Datos inválidos' });
  });

  it('rejects when the parent draft is missing/not owned', async () => {
    prismaMock.storyDraft.findUnique.mockResolvedValue(null);
    expect(await regenerateDraftAction(input)).toEqual({ ok: false, error: 'Draft no encontrado' });
  });

  it('rejects while the parent is still generating', async () => {
    prismaMock.storyDraft.findUnique.mockResolvedValue({ authorId: 'u1', status: 'GENERATING', project: { slug: 's' } });
    const res = await regenerateDraftAction(input);
    expect(res.ok).toBe(false);
  });

  it('creates a new regenerated draft', async () => {
    prismaMock.storyDraft.findUnique.mockResolvedValue({
      id: 'parent', authorId: 'u1', status: 'READY', projectId: 'p1', provider: 'ANTHROPIC', model: 'm',
      rawInput: 'x', selectedPaths: [], citedMemoryIds: [], project: { slug: 's' },
    });
    prismaMock.storyDraft.create.mockResolvedValue({ id: 'new' });
    const res = await regenerateDraftAction(input);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'story.draft.start' }));
    expect(res).toEqual({ ok: true, draftId: 'new' });
  });
});
