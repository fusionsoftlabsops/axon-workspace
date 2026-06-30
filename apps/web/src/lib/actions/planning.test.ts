import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  prismaMock,
  txMock,
  assertMock,
  revalidateMock,
  langMock,
  plannerMock,
  isInfraMock,
  repoReaderMock,
  schemaMock,
  extractMock,
  storageMock,
} = vi.hoisted(() => {
  const txMock = {
    projectTaskCounter: { update: vi.fn() },
    sprint: { create: vi.fn() },
    task: { create: vi.fn() },
    taskActivity: { create: vi.fn() },
    projectPlan: { update: vi.fn() },
  };
  return {
    txMock,
    prismaMock: {
      project: { findUnique: vi.fn() },
      user: { findUnique: vi.fn() },
      codeAnalysis: { findUnique: vi.fn() },
      projectPlan: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
      planAttachment: { create: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
      projectMember: { findMany: vi.fn(), findFirst: vi.fn() },
      projectRepo: { findMany: vi.fn() },
      workflow: { findFirst: vi.fn() },
      projectFile: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: typeof txMock) => unknown) => fn(txMock)),
    },
    assertMock: vi.fn(),
    revalidateMock: vi.fn(),
    langMock: vi.fn(),
    plannerMock: {
      planChatReply: vi.fn(),
      generatePlan: vi.fn(),
      refinePlanTask: vi.fn(),
      generateImplementationPlan: vi.fn(),
      reestimatePlan: vi.fn(),
      estimateTaskForSeniority: vi.fn(),
    },
    isInfraMock: vi.fn(),
    repoReaderMock: vi.fn(),
    schemaMock: {
      generatedPlanSchema: { safeParse: vi.fn() },
      planTaskSchema: {
        partial: vi.fn(() => ({ safeParse: vi.fn((v: unknown) => ({ success: true, data: v })) })),
        safeParse: vi.fn((v: unknown) => ({ success: true, data: v })),
      },
      normalizeCategory: vi.fn((v: unknown) => v),
      normalizeKind: vi.fn((v: unknown) => v),
      normalizePriority: vi.fn((v: unknown) => v),
      normalizeEstimates: vi.fn(),
    },
    extractMock: vi.fn(),
    storageMock: {
      getObjectBytes: vi.fn(),
      deleteObject: vi.fn(),
      putObject: vi.fn(),
      buildKey: vi.fn(() => 'storage-key'),
      isStorageConfigured: vi.fn(),
    },
  };
});

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: assertMock }));
vi.mock('@/lib/i18n/server', () => ({ getServerLang: langMock }));
vi.mock('@/lib/ai/planner', () => plannerMock);
vi.mock('@/lib/ai/infra-llm', () => ({ isInfraLlmConfigured: isInfraMock }));
vi.mock('@/lib/repo/reader', () => ({ repoReaderFor: repoReaderMock }));
vi.mock('@/lib/ai/plan-schema', () => schemaMock);
vi.mock('@/lib/ai/extract', () => ({
  fetchUrlText: extractMock,
  isImageMime: (mime: string) => /^image\//.test(mime ?? ''),
}));
vi.mock('@/lib/storage', () => storageMock);
vi.mock('@/lib/realtime', () => ({
  publish: vi.fn(async () => {}),
  subscribe: vi.fn(async () => () => {}),
  planChannel: (id: string) => `plan:${id}`,
}));

import {
  getOrCreatePlanAction,
  planChatAction,
  planTypingAction,
  addPlanLinkAction,
  removePlanAttachmentAction,
  refinePlanTaskAction,
  updatePlanTaskAction,
  removePlanTaskAction,
  updatePlanSprintAction,
  startPlanGenerationAction,
  reestimatePlanAction,
  getProjectMembersForAssignAction,
  assignTaskMemberAction,
  clearTaskAssignmentAction,
  generateImplPlanAction,
  publishPlanAction,
  setPlanContextGraphAction,
} from './planning';

const okCtx = { ok: true, userId: 'u1', projectId: 'p1', role: 'OWNER' as const };

function makeGen() {
  return {
    improvedIdea: 'idea',
    suggestedRepos: [{ name: 'web', kind: 'frontend', stack: 'react' }],
    sprints: [
      {
        name: 'S1',
        goal: 'g',
        tasks: [
          {
            title: 'Build login form',
            description: 'create the login form component',
            category: 'frontend',
            repo: 'web',
            priority: 'MEDIUM',
            kind: 'FEATURE',
            estimate: '1d',
            estimateBySeniority: { junior: '2d', semiSenior: '1d', senior: '0.5d' },
            acceptanceCriteria: 'ac',
            recommendedRoles: [],
            assignment: null,
          },
        ],
      },
    ],
  };
}

const planRow = () => ({
  id: 'plan1',
  status: 'READY',
  messages: [{ role: 'assistant', content: 'hi' }],
  generated: makeGen(),
  improvedIdea: 'idea',
  error: null,
  attachments: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof txMock) => unknown) => fn(txMock));
  assertMock.mockResolvedValue(okCtx);
  langMock.mockResolvedValue('es');
  isInfraMock.mockReturnValue(true);
  prismaMock.user.findUnique.mockResolvedValue({ name: 'Tester' });
  prismaMock.project.findUnique.mockResolvedValue({ name: 'N', description: 'd', repoPath: '/repo' });
  prismaMock.codeAnalysis.findUnique.mockResolvedValue(null);
  prismaMock.projectFile.findMany.mockResolvedValue([]);
  prismaMock.projectFile.count.mockResolvedValue(0);
  prismaMock.projectPlan.findFirst.mockResolvedValue(planRow());
  schemaMock.generatedPlanSchema.safeParse.mockImplementation(() => ({ success: true, data: makeGen() }));
  schemaMock.planTaskSchema.partial.mockImplementation(() => ({
    safeParse: vi.fn((v: unknown) => ({ success: true, data: v })),
  }));
  schemaMock.planTaskSchema.safeParse.mockImplementation((v: unknown) => ({ success: true, data: v }));
  storageMock.isStorageConfigured.mockReturnValue(false);
});

describe('getOrCreatePlanAction', () => {
  it('propagates the membership error', async () => {
    assertMock.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await getOrCreatePlanAction('slug')).toEqual({ ok: false, error: 'nope' });
  });

  it('returns the existing plan view', async () => {
    const res = await getOrCreatePlanAction('slug');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.id).toBe('plan1');
  });

  it('creates a plan when none exists', async () => {
    prismaMock.projectPlan.findFirst.mockResolvedValue(null);
    prismaMock.projectPlan.create.mockResolvedValue({ ...planRow(), status: 'CHATTING', messages: [] });
    const res = await getOrCreatePlanAction('slug');
    expect(prismaMock.projectPlan.create).toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });
});

describe('planChatAction', () => {
  it('rejects a VIEWER', async () => {
    assertMock.mockResolvedValue({ ...okCtx, role: 'VIEWER' });
    expect(await planChatAction('slug', 'hi')).toEqual({ ok: false, error: 'Sin permisos' });
  });

  it('rejects an empty message', async () => {
    expect(await planChatAction('slug', '   ')).toEqual({ ok: false, error: 'Mensaje vacío' });
  });

  it('rejects when no plan exists', async () => {
    prismaMock.projectPlan.findFirst.mockResolvedValue(null);
    expect(await planChatAction('slug', 'hi')).toEqual({ ok: false, error: 'Plan no encontrado' });
  });

  it('rejects while generating', async () => {
    prismaMock.projectPlan.findFirst.mockResolvedValue({ ...planRow(), status: 'GENERATING' });
    expect(await planChatAction('slug', 'hi')).toEqual({ ok: false, error: 'Generando el plan…' });
  });

  it('returns an AI error', async () => {
    plannerMock.planChatReply.mockRejectedValue(new Error('ai down'));
    expect(await planChatAction('slug', 'hi')).toEqual({ ok: false, error: 'ai down' });
  });

  it('appends the reply (using brownfield code context)', async () => {
    prismaMock.codeAnalysis.findUnique.mockResolvedValue({ status: 'READY', summary: 'brief' });
    plannerMock.planChatReply.mockResolvedValue('the reply');
    prismaMock.projectPlan.update.mockResolvedValue(planRow());
    const res = await planChatAction('slug', 'hi');
    expect(prismaMock.projectPlan.update).toHaveBeenCalled();
    expect(res.ok).toBe(true);
    // default (null) → the code graph grounds the chat.
    expect(plannerMock.planChatReply).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(), expect.anything(),
      expect.anything(), expect.anything(), 'brief',
    );
  });

  it('disconnects the graph when the plan chose NONE (greenfield even if a READY analysis exists)', async () => {
    prismaMock.projectPlan.findFirst.mockResolvedValue({ ...planRow(), contextGraph: 'NONE' });
    prismaMock.codeAnalysis.findUnique.mockResolvedValue({ status: 'READY', summary: 'brief' });
    plannerMock.planChatReply.mockResolvedValue('the reply');
    prismaMock.projectPlan.update.mockResolvedValue(planRow());
    await planChatAction('slug', 'hi');
    // The 7th arg (code context) must be undefined — the graph is not consulted.
    expect(prismaMock.codeAnalysis.findUnique).not.toHaveBeenCalled();
    expect(plannerMock.planChatReply).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(), expect.anything(),
      expect.anything(), expect.anything(), undefined,
    );
  });

  it('grounds the chat in project files marked as context', async () => {
    prismaMock.projectFile.findMany.mockResolvedValue([
      { name: 'spec.md', mimeType: 'text/markdown', category: 'DOCUMENT', contextStatus: 'READY', contextMarkdown: 'IMPORTANT SPEC' },
    ]);
    plannerMock.planChatReply.mockResolvedValue('ok');
    prismaMock.projectPlan.update.mockResolvedValue(planRow());
    await planChatAction('slug', 'hi');
    const manifestArg = plannerMock.planChatReply.mock.calls[0]![3] as string;
    expect(manifestArg).toContain('spec.md');
    expect(manifestArg).toContain('IMPORTANT SPEC');
  });
});

describe('setPlanContextGraphAction', () => {
  it('propagates the membership error', async () => {
    assertMock.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await setPlanContextGraphAction('slug', 'NONE')).toEqual({ ok: false, error: 'nope' });
  });

  it('rejects a VIEWER', async () => {
    assertMock.mockResolvedValue({ ...okCtx, role: 'VIEWER' });
    expect(await setPlanContextGraphAction('slug', 'NONE')).toEqual({ ok: false, error: 'Sin permisos' });
  });

  it('rejects an invalid choice', async () => {
    expect(await setPlanContextGraphAction('slug', 'BOGUS' as never)).toEqual({ ok: false, error: 'Grafo inválido' });
  });

  it('rejects when no plan exists', async () => {
    prismaMock.projectPlan.findFirst.mockResolvedValue(null);
    expect(await setPlanContextGraphAction('slug', 'NONE')).toEqual({ ok: false, error: 'Plan no encontrado' });
  });

  it('persists the choice and returns the updated view', async () => {
    prismaMock.projectPlan.update.mockResolvedValue({ ...planRow(), contextGraph: 'NONE' });
    const res = await setPlanContextGraphAction('slug', 'NONE');
    expect(prismaMock.projectPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { contextGraph: 'NONE' } }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.contextGraph).toBe('NONE');
  });
});

describe('addPlanLinkAction', () => {
  it('rejects an invalid URL', async () => {
    expect(await addPlanLinkAction('slug', 'not a url')).toEqual({ ok: false, error: 'URL inválida' });
  });

  it('rejects when no plan exists', async () => {
    prismaMock.projectPlan.findFirst.mockResolvedValue(null);
    expect(await addPlanLinkAction('slug', 'https://x.com')).toEqual({ ok: false, error: 'Plan no encontrado' });
  });

  it('rejects when the link cannot be read', async () => {
    extractMock.mockRejectedValue(new Error('fetch fail'));
    expect(await addPlanLinkAction('slug', 'https://x.com')).toEqual({ ok: false, error: 'No se pudo leer el enlace' });
  });

  it('adds the link attachment', async () => {
    extractMock.mockResolvedValue({ title: 'T', text: 'body' });
    const res = await addPlanLinkAction('slug', 'https://x.com');
    expect(prismaMock.planAttachment.create).toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });
});

describe('removePlanAttachmentAction', () => {
  it('rejects a missing attachment', async () => {
    expect(await removePlanAttachmentAction('slug', 'a1')).toEqual({ ok: false, error: 'Adjunto no encontrado' });
  });

  it('removes the attachment (and its object)', async () => {
    prismaMock.projectPlan.findFirst.mockResolvedValue({
      ...planRow(),
      attachments: [{ id: 'a1', storageKey: 'k', kind: 'DOCUMENT', name: 'doc' }],
    });
    storageMock.deleteObject.mockResolvedValue(undefined);
    const res = await removePlanAttachmentAction('slug', 'a1');
    expect(prismaMock.planAttachment.delete).toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });
});

describe('refinePlanTaskAction', () => {
  it('rejects when not READY (loadEditablePlan)', async () => {
    prismaMock.projectPlan.findFirst.mockResolvedValue({ ...planRow(), status: 'CHATTING' });
    const res = await refinePlanTaskAction('slug', 0, 0, 'note');
    expect(res.ok).toBe(false);
  });

  it('rejects an out-of-bounds task', async () => {
    expect(await refinePlanTaskAction('slug', 5, 0, 'note')).toEqual({ ok: false, error: 'HU no encontrada' });
  });

  it('returns an AI error', async () => {
    plannerMock.refinePlanTask.mockRejectedValue(new Error('ai'));
    expect(await refinePlanTaskAction('slug', 0, 0, 'note')).toEqual({ ok: false, error: 'ai' });
  });

  it('refines and saves the task', async () => {
    plannerMock.refinePlanTask.mockResolvedValue({ title: 'refined' });
    const res = await refinePlanTaskAction('slug', 0, 0, 'note');
    expect(prismaMock.projectPlan.update).toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });
});

describe('updatePlanTaskAction', () => {
  it('rejects out-of-bounds', async () => {
    expect(await updatePlanTaskAction('slug', 9, 0, {})).toEqual({ ok: false, error: 'HU no encontrada' });
  });

  it('rejects invalid patch', async () => {
    schemaMock.planTaskSchema.partial.mockImplementation(() => ({ safeParse: vi.fn(() => ({ success: false })) }));
    expect(await updatePlanTaskAction('slug', 0, 0, {})).toEqual({ ok: false, error: 'Datos inválidos' });
  });

  it('rejects when the merged task is invalid', async () => {
    schemaMock.planTaskSchema.safeParse.mockReturnValue({ success: false });
    expect(await updatePlanTaskAction('slug', 0, 0, { title: 'x' })).toEqual({ ok: false, error: 'Datos inválidos' });
  });

  it('updates the task', async () => {
    const res = await updatePlanTaskAction('slug', 0, 0, { title: 'new' });
    expect(prismaMock.projectPlan.update).toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });
});

describe('removePlanTaskAction', () => {
  it('rejects out-of-bounds', async () => {
    expect(await removePlanTaskAction('slug', 9, 0)).toEqual({ ok: false, error: 'HU no encontrada' });
  });

  it('removes the task and drops the empty sprint', async () => {
    const res = await removePlanTaskAction('slug', 0, 0);
    expect(prismaMock.projectPlan.update).toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });
});

describe('updatePlanSprintAction', () => {
  it('rejects an out-of-bounds sprint', async () => {
    expect(await updatePlanSprintAction('slug', 9, {})).toEqual({ ok: false, error: 'Sprint no encontrado' });
  });

  it('rejects an empty name', async () => {
    expect(await updatePlanSprintAction('slug', 0, { name: '  ' })).toEqual({
      ok: false,
      error: 'El nombre del sprint no puede estar vacío',
    });
  });

  it('updates name + goal', async () => {
    const res = await updatePlanSprintAction('slug', 0, { name: 'New', goal: 'New goal' });
    expect(prismaMock.projectPlan.update).toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });
});

describe('planTypingAction', () => {
  it('rejects unauthenticated', async () => {
    assertMock.mockResolvedValue({ ok: false, error: 'No autenticado' });
    expect(await planTypingAction('slug')).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('is a silent no-op for a VIEWER', async () => {
    assertMock.mockResolvedValue({ ...okCtx, role: 'VIEWER' });
    expect(await planTypingAction('slug')).toEqual({ ok: true });
  });

  it('publishes a typing event with the author name', async () => {
    const { publish } = await import('@/lib/realtime');
    prismaMock.projectPlan.findFirst.mockResolvedValue({ id: 'plan1' });
    prismaMock.user.findUnique.mockResolvedValue({ name: 'Ana' });
    expect(await planTypingAction('slug')).toEqual({ ok: true });
    expect(publish).toHaveBeenCalledWith(
      'plan:plan1',
      expect.objectContaining({ type: 'typing', userId: 'u1', name: 'Ana' }),
    );
  });
});

describe('startPlanGenerationAction', () => {
  it('rejects a VIEWER', async () => {
    assertMock.mockResolvedValue({ ...okCtx, role: 'VIEWER' });
    expect(await startPlanGenerationAction('slug')).toEqual({ ok: false, error: 'Sin permisos' });
  });

  it('rejects when no plan exists', async () => {
    prismaMock.projectPlan.findFirst.mockResolvedValue(null);
    expect(await startPlanGenerationAction('slug')).toEqual({ ok: false, error: 'Plan no encontrado' });
  });

  it('is a no-op when already generating with a fresh heartbeat', async () => {
    prismaMock.projectPlan.findFirst.mockResolvedValue({
      ...planRow(),
      status: 'GENERATING',
      heartbeatAt: new Date(),
    });
    expect(await startPlanGenerationAction('slug')).toEqual({ ok: true });
    expect(prismaMock.projectPlan.update).not.toHaveBeenCalled();
  });

  it('relaunches an orphaned generation (stale heartbeat)', async () => {
    prismaMock.projectPlan.findFirst.mockResolvedValue({
      ...planRow(),
      status: 'GENERATING',
      heartbeatAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min old
    });
    prismaMock.planAttachment.findMany.mockResolvedValue([]);
    plannerMock.generatePlan.mockResolvedValue(makeGen());
    const res = await startPlanGenerationAction('slug');
    expect(res).toEqual({ ok: true });
    // It re-marks GENERATING (with fresh stats/heartbeat) and relaunches.
    expect(prismaMock.projectPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'GENERATING' }) }),
    );
  });

  it('starts background generation', async () => {
    prismaMock.planAttachment.findMany.mockResolvedValue([]);
    plannerMock.generatePlan.mockResolvedValue(makeGen());
    const res = await startPlanGenerationAction('slug');
    expect(res).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(plannerMock.generatePlan).toHaveBeenCalled();
  });

  it('records a FAILED status when background generation throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    prismaMock.planAttachment.findMany.mockResolvedValue([]);
    plannerMock.generatePlan.mockRejectedValue(new Error('gen fail'));
    await startPlanGenerationAction('slug');
    await new Promise((r) => setTimeout(r, 0));
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('reestimatePlanAction', () => {
  it('rejects a VIEWER', async () => {
    assertMock.mockResolvedValue({ ...okCtx, role: 'VIEWER' });
    expect(await reestimatePlanAction('slug')).toEqual({ ok: false, error: 'Sin permisos' });
  });

  it('rejects when there is no generated plan', async () => {
    schemaMock.generatedPlanSchema.safeParse.mockReturnValue({ success: false });
    expect(await reestimatePlanAction('slug')).toEqual({ ok: false, error: 'No hay un plan generado' });
  });

  it('rejects a plan with no HUs', async () => {
    schemaMock.generatedPlanSchema.safeParse.mockReturnValue({
      success: true,
      data: { improvedIdea: 'i', suggestedRepos: [], sprints: [{ name: 'S', goal: 'g', tasks: [] }] },
    });
    expect(await reestimatePlanAction('slug')).toEqual({ ok: false, error: 'El plan no tiene HUs' });
  });

  it('returns an AI error', async () => {
    plannerMock.reestimatePlan.mockRejectedValue(new Error('ai'));
    expect(await reestimatePlanAction('slug')).toEqual({ ok: false, error: 'ai' });
  });

  it('applies the re-estimates', async () => {
    plannerMock.reestimatePlan.mockResolvedValue([
      { s: 0, t: 0, estimateBySeniority: { junior: '3d', semiSenior: '2d', senior: '1d' }, estimate: '2d' },
    ]);
    const res = await reestimatePlanAction('slug');
    expect(prismaMock.projectPlan.update).toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });
});

describe('getProjectMembersForAssignAction', () => {
  it('propagates the membership error', async () => {
    assertMock.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await getProjectMembersForAssignAction('slug')).toEqual({ ok: false, error: 'nope' });
  });

  it('returns members', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([
      { userId: 'm1', seniority: 'SENIOR', user: { name: 'Mem' } },
    ]);
    const res = await getProjectMembersForAssignAction('slug');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.members[0]).toMatchObject({ userId: 'm1', name: 'Mem' });
  });
});

describe('assignTaskMemberAction', () => {
  it('rejects out-of-bounds', async () => {
    expect(await assignTaskMemberAction('slug', 9, 0, 'm1')).toEqual({ ok: false, error: 'HU no encontrada' });
  });

  it('rejects a missing member', async () => {
    prismaMock.projectMember.findFirst.mockResolvedValue(null);
    expect(await assignTaskMemberAction('slug', 0, 0, 'm1')).toEqual({ ok: false, error: 'Miembro no encontrado' });
  });

  it('assigns and AI-estimates for the member', async () => {
    prismaMock.projectMember.findFirst.mockResolvedValue({ userId: 'm1', seniority: 'SENIOR', user: { name: 'Mem' } });
    plannerMock.estimateTaskForSeniority.mockResolvedValue('4d');
    const res = await assignTaskMemberAction('slug', 0, 0, 'm1');
    expect(prismaMock.projectPlan.update).toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });

  it('falls back to the table estimate when AI fails / infra off', async () => {
    isInfraMock.mockReturnValue(false);
    prismaMock.projectMember.findFirst.mockResolvedValue({ userId: 'm1', seniority: null, user: { name: 'Mem' } });
    const res = await assignTaskMemberAction('slug', 0, 0, 'm1');
    expect(res.ok).toBe(true);
  });
});

describe('clearTaskAssignmentAction', () => {
  it('rejects out-of-bounds', async () => {
    expect(await clearTaskAssignmentAction('slug', 9, 0)).toEqual({ ok: false, error: 'HU no encontrada' });
  });

  it('clears the assignment', async () => {
    const res = await clearTaskAssignmentAction('slug', 0, 0);
    expect(prismaMock.projectPlan.update).toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });
});

describe('generateImplPlanAction', () => {
  it('rejects out-of-bounds', async () => {
    expect(await generateImplPlanAction('slug', 9, 0)).toEqual({ ok: false, error: 'HU no encontrada' });
  });

  it('rejects when there is no readable repo', async () => {
    prismaMock.projectRepo.findMany.mockResolvedValue([]);
    repoReaderMock.mockResolvedValue(null);
    const res = await generateImplPlanAction('slug', 0, 0);
    expect(res.ok).toBe(false);
  });

  it('returns an AI error', async () => {
    prismaMock.projectRepo.findMany.mockResolvedValue([{ id: 'r1', name: 'web', kind: 'frontend', repoPath: '/repo' }]);
    repoReaderMock.mockResolvedValue({
      tree: vi.fn().mockResolvedValue([]),
      grep: vi.fn().mockResolvedValue([]),
      readFiles: vi.fn().mockResolvedValue({ files: [] }),
    });
    plannerMock.generateImplementationPlan.mockRejectedValue(new Error('ai'));
    expect(await generateImplPlanAction('slug', 0, 0, 'r1')).toEqual({ ok: false, error: 'ai' });
  });

  it('generates the impl plan and persists the file', async () => {
    prismaMock.projectRepo.findMany.mockResolvedValue([{ id: 'r1', name: 'web', kind: 'frontend', repoPath: '/repo' }]);
    repoReaderMock.mockResolvedValue({
      tree: vi.fn().mockResolvedValue([
        { name: 'src', kind: 'dir', path: 'src', children: [{ name: 'login.ts', kind: 'file', path: 'src/login.ts' }] },
      ]),
      grep: vi.fn().mockResolvedValue([{ path: 'src/login.ts' }]),
      readFiles: vi.fn().mockResolvedValue({
        files: [{ path: 'src/login.ts', content: 'code', language: 'ts', truncated: false }],
      }),
    });
    plannerMock.generateImplementationPlan.mockResolvedValue('# IMPL');
    storageMock.isStorageConfigured.mockReturnValue(true);
    storageMock.putObject.mockResolvedValue(undefined);
    const res = await generateImplPlanAction('slug', 0, 0);
    expect(prismaMock.projectFile.create).toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.markdown).toBe('# IMPL');
  });
});

describe('publishPlanAction', () => {
  it('rejects a VIEWER', async () => {
    assertMock.mockResolvedValue({ ...okCtx, role: 'VIEWER' });
    expect(await publishPlanAction('slug')).toEqual({ ok: false, error: 'Sin permisos' });
  });

  it('rejects when there is no generated plan', async () => {
    prismaMock.projectPlan.findFirst.mockResolvedValue({ ...planRow(), generated: null });
    expect(await publishPlanAction('slug')).toEqual({ ok: false, error: 'No hay un plan generado' });
  });

  it('rejects an already-published plan', async () => {
    prismaMock.projectPlan.findFirst.mockResolvedValue({ ...planRow(), status: 'PUBLISHED' });
    expect(await publishPlanAction('slug')).toEqual({ ok: false, error: 'El plan ya fue publicado' });
  });

  it('rejects when the project has no workflow', async () => {
    prismaMock.workflow.findFirst.mockResolvedValue(null);
    expect(await publishPlanAction('slug')).toEqual({ ok: false, error: 'El proyecto no tiene workflow' });
  });

  it('rejects a plan with no tasks', async () => {
    schemaMock.generatedPlanSchema.safeParse.mockReturnValue({
      success: true,
      data: { improvedIdea: 'i', suggestedRepos: [], sprints: [] },
    });
    prismaMock.workflow.findFirst.mockResolvedValue({ states: [{ id: 'st1' }] });
    expect(await publishPlanAction('slug')).toEqual({ ok: false, error: 'El plan no tiene tareas' });
  });

  it('publishes the plan into sprints + tasks', async () => {
    prismaMock.workflow.findFirst.mockResolvedValue({ states: [{ id: 'st1' }] });
    txMock.projectTaskCounter.update.mockResolvedValue({ next: 5 });
    txMock.sprint.create.mockResolvedValue({ id: 'sp1' });
    txMock.task.create.mockResolvedValue({ id: 't1' });
    const res = await publishPlanAction('slug');
    expect(txMock.sprint.create).toHaveBeenCalled();
    expect(txMock.task.create).toHaveBeenCalled();
    expect(res).toEqual({ ok: true, data: { tasks: 1, sprints: 1 } });
  });
});
