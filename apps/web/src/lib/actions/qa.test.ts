import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, txMock, authMock, revalidateMock, genMock, langMock, auditMock, extractMock } =
  vi.hoisted(() => {
    const txMock = {
      task: { update: vi.fn() },
      taskActivity: { create: vi.fn() },
      taskComment: { create: vi.fn() },
    };
    return {
      txMock,
      prismaMock: {
        project: { findUnique: vi.fn() },
        task: { findUnique: vi.fn(), update: vi.fn() },
        workflow: { findFirst: vi.fn() },
        $transaction: vi.fn(async (fn: (tx: typeof txMock) => unknown) => fn(txMock)),
      },
      authMock: vi.fn(),
      revalidateMock: vi.fn(),
      genMock: vi.fn(),
      langMock: vi.fn(),
      auditMock: vi.fn(),
      extractMock: vi.fn(),
    };
  });

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/i18n/server', () => ({ getServerLang: langMock }));
vi.mock('@/lib/ai/planner', () => ({ generateQaTests: genMock }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));
vi.mock('./brain', () => ({ extractMemoriesFromTaskAction: extractMock }));

import { generateQaTestsAction, qaDecisionAction } from './qa';

const memberAs = (role: string) => ({ id: 'p1', members: [{ role }] });
const taskRow = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  taskNumber: 3,
  title: 'Login',
  description: 'desc',
  acceptanceCriteria: 'AC',
  qaHandoff: null,
  qaTests: null,
  assignee: null,
  _count: { comments: 1 },
  projectId: 'p1',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof txMock) => unknown) => fn(txMock));
  authMock.mockResolvedValue({ user: { id: 'u1' } });
  langMock.mockResolvedValue('es');
  prismaMock.project.findUnique.mockResolvedValue(memberAs('OWNER'));
  extractMock.mockResolvedValue({ ok: true });
});

describe('generateQaTestsAction', () => {
  it('rejects a VIEWER', async () => {
    prismaMock.project.findUnique.mockResolvedValue(memberAs('VIEWER'));
    expect(await generateQaTestsAction('slug', 't1')).toEqual({ ok: false, error: 'Sin permisos' });
  });

  it('rejects a task from another project', async () => {
    prismaMock.task.findUnique.mockResolvedValue(taskRow({ projectId: 'other' }));
    expect(await generateQaTestsAction('slug', 't1')).toEqual({ ok: false, error: 'Tarea no encontrada' });
  });

  it('generates tests and persists them', async () => {
    prismaMock.task.findUnique.mockResolvedValue(taskRow());
    genMock.mockResolvedValue([{ title: 'Login OK', steps: '1..', expected: 'entra' }]);
    prismaMock.task.update.mockResolvedValue(
      taskRow({ qaTests: { tests: [{ title: 'Login OK' }], generatedAt: 'now' } }),
    );
    const res = await generateQaTestsAction('slug', 't1');
    expect(res.ok).toBe(true);
    expect(prismaMock.task.update).toHaveBeenCalled();
    const data = prismaMock.task.update.mock.calls[0]![0].data.qaTests as { tests: unknown[] };
    expect(data.tests).toHaveLength(1);
    if (res.ok) expect(res.data!.qaTests?.tests[0]!.title).toBe('Login OK');
  });

  it('surfaces an AI error', async () => {
    prismaMock.task.findUnique.mockResolvedValue(taskRow());
    genMock.mockRejectedValue(new Error('ai down'));
    expect(await generateQaTestsAction('slug', 't1')).toEqual({ ok: false, error: 'ai down' });
  });
});

describe('qaDecisionAction', () => {
  const workflow = {
    states: [
      { id: 's-done', category: 'DONE' },
      { id: 's-dev', category: 'IN_PROGRESS' },
    ],
  };

  it('rejects a VIEWER', async () => {
    prismaMock.project.findUnique.mockResolvedValue(memberAs('VIEWER'));
    expect(await qaDecisionAction('slug', 't1', 'approve')).toEqual({ ok: false, error: 'Sin permisos' });
  });

  it('requires a reason to reject', async () => {
    expect(await qaDecisionAction('slug', 't1', 'reject', '  ')).toEqual({
      ok: false,
      error: 'Indica el motivo del rechazo',
    });
  });

  it('approve → moves to DONE and fires the brain extractor', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 't1', projectId: 'p1', stateId: 's-review' });
    prismaMock.workflow.findFirst.mockResolvedValue(workflow);
    const res = await qaDecisionAction('slug', 't1', 'approve', 'ok');
    expect(res.ok).toBe(true);
    expect(txMock.task.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { stateId: 's-done' } });
    expect(txMock.taskComment.create).toHaveBeenCalled();
    expect(extractMock).toHaveBeenCalledWith('slug', 't1', 'u1');
  });

  it('reject → moves to IN_PROGRESS, no extractor', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 't1', projectId: 'p1', stateId: 's-review' });
    prismaMock.workflow.findFirst.mockResolvedValue(workflow);
    const res = await qaDecisionAction('slug', 't1', 'reject', 'faltan validaciones');
    expect(res.ok).toBe(true);
    expect(txMock.task.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { stateId: 's-dev' } });
    expect(extractMock).not.toHaveBeenCalled();
  });

  it('errors when the target state category is missing', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 't1', projectId: 'p1', stateId: 's-review' });
    prismaMock.workflow.findFirst.mockResolvedValue({ states: [{ id: 's-open', category: 'OPEN' }] });
    const res = await qaDecisionAction('slug', 't1', 'approve', 'ok');
    expect(res.ok).toBe(false);
  });
});
