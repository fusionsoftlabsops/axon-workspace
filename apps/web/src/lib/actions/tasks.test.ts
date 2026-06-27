import { describe, it, expect, vi, beforeEach } from 'vitest';

const CUID = 'cjld2cjxh0000qzrmn831i7rn';
const CUID2 = 'cjld2cyuq0000t3rmniod1foy';
const CUID3 = 'cjld2cjxh0000qzrmn831i999';

const { prismaMock, txMock, authMock, revalidateMock, extractMock } = vi.hoisted(() => {
  const txMock = {
    projectTaskCounter: { update: vi.fn() },
    task: { aggregate: vi.fn(), create: vi.fn(), update: vi.fn() },
    taskActivity: { create: vi.fn(), createMany: vi.fn() },
    taskComment: { create: vi.fn() },
  };
  return {
    txMock,
    prismaMock: {
      project: { findUnique: vi.fn() },
      task: { findUnique: vi.fn(), delete: vi.fn() },
      workflowState: { findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: typeof txMock) => unknown) => fn(txMock)),
    },
    authMock: vi.fn(),
    revalidateMock: vi.fn(),
    extractMock: vi.fn(),
  };
});

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('./brain', () => ({ extractMemoriesFromTaskAction: extractMock }));

import {
  createTaskAction,
  updateTaskAction,
  moveTaskAction,
  addCommentAction,
  deleteTaskAction,
} from './tasks';

const memberAs = (role: string) => ({ id: 'p1', members: [{ role }] });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof txMock) => unknown) => fn(txMock));
  authMock.mockResolvedValue({ user: { id: 'u1' } });
  prismaMock.project.findUnique.mockResolvedValue(memberAs('OWNER'));
  txMock.projectTaskCounter.update.mockResolvedValue({ next: 5 });
  txMock.task.aggregate.mockResolvedValue({ _max: { positionInState: 2 } });
  txMock.task.create.mockResolvedValue({ id: 't1', taskNumber: 4, title: 'T', stateId: CUID });
  extractMock.mockResolvedValue({ ok: true });
});

describe('createTaskAction', () => {
  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await createTaskAction('slug', { stateId: CUID, title: 'T' })).toEqual({
      ok: false,
      error: 'No autenticado',
    });
  });

  it('rejects a VIEWER', async () => {
    prismaMock.project.findUnique.mockResolvedValue(memberAs('VIEWER'));
    const res = await createTaskAction('slug', { stateId: CUID, title: 'T' });
    expect(res).toEqual({ ok: false, error: 'Sin permisos para crear tareas' });
  });

  it('rejects invalid input', async () => {
    const res = await createTaskAction('slug', { stateId: 'not-cuid', title: '' } as never);
    expect(res).toEqual({ ok: false, error: 'Datos inválidos' });
  });

  it('creates a task with the next number and position', async () => {
    const res = await createTaskAction('slug', { stateId: CUID, title: 'T' });
    expect(txMock.task.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ taskNumber: 4, positionInState: 3 }) }),
    );
    expect(revalidateMock).toHaveBeenCalledWith('/projects/slug/board');
    expect(res).toEqual({ ok: true, data: { taskNumber: 4 } });
  });

  it('defaults position to 0 when the column is empty', async () => {
    txMock.task.aggregate.mockResolvedValue({ _max: { positionInState: null } });
    await createTaskAction('slug', { stateId: CUID, title: 'T' });
    expect(txMock.task.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ positionInState: 0 }) }),
    );
  });
});

describe('updateTaskAction', () => {
  it('rejects a VIEWER', async () => {
    prismaMock.project.findUnique.mockResolvedValue(memberAs('VIEWER'));
    expect(await updateTaskAction('slug', { id: CUID })).toEqual({ ok: false, error: 'Sin permisos' });
  });

  it('rejects invalid input', async () => {
    const res = await updateTaskAction('slug', { id: 'bad' } as never);
    expect(res).toEqual({ ok: false, error: 'Datos inválidos' });
  });

  it('rejects when the task is not in this project', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: CUID, projectId: 'other' });
    expect(await updateTaskAction('slug', { id: CUID })).toEqual({ ok: false, error: 'Tarea no encontrada' });
  });

  it('records activities for tracked field changes', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: CUID,
      projectId: 'p1',
      stateId: 'oldState',
      assigneeId: null,
      priority: 'LOW',
      title: 'old',
    });
    const res = await updateTaskAction('slug', {
      id: CUID,
      stateId: CUID2,
      assigneeId: CUID3,
      priority: 'HIGH',
      title: 'new',
    });
    expect(txMock.task.update).toHaveBeenCalled();
    expect(txMock.taskActivity.createMany).toHaveBeenCalledTimes(1);
    const arg = txMock.taskActivity.createMany.mock.calls[0]![0] as { data: unknown[] };
    expect(arg.data).toHaveLength(4);
    expect(res).toEqual({ ok: true });
  });

  it('records no activity when nothing tracked changed', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: CUID,
      projectId: 'p1',
      stateId: 'oldState',
      assigneeId: null,
      priority: 'LOW',
      title: 'same',
    });
    await updateTaskAction('slug', { id: CUID, title: 'same' });
    expect(txMock.taskActivity.createMany).not.toHaveBeenCalled();
  });
});

describe('moveTaskAction', () => {
  it('rejects a VIEWER', async () => {
    prismaMock.project.findUnique.mockResolvedValue(memberAs('VIEWER'));
    expect(await moveTaskAction('slug', 't1', 's2', [])).toEqual({ ok: false, error: 'Sin permisos' });
  });

  it('rejects an unknown task', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null);
    expect(await moveTaskAction('slug', 't1', 's2', [])).toEqual({ ok: false, error: 'Tarea no encontrada' });
  });

  it('moves the task and triggers brain extraction when entering DONE', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 't1', projectId: 'p1', stateId: 's1' });
    prismaMock.workflowState.findUnique.mockResolvedValue({ category: 'DONE' });
    const res = await moveTaskAction('slug', 't1', 's2', ['t1', 't2']);
    expect(txMock.task.update).toHaveBeenCalledTimes(2);
    expect(txMock.taskActivity.create).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0));
    expect(extractMock).toHaveBeenCalledWith('slug', 't1', 'u1');
    expect(res).toEqual({ ok: true });
  });

  it('does not extract memories when not entering DONE', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 't1', projectId: 'p1', stateId: 's1' });
    prismaMock.workflowState.findUnique.mockResolvedValue({ category: 'IN_PROGRESS' });
    await moveTaskAction('slug', 't1', 's2', ['t1']);
    expect(extractMock).not.toHaveBeenCalled();
  });
});

describe('addCommentAction', () => {
  it('rejects a VIEWER', async () => {
    prismaMock.project.findUnique.mockResolvedValue(memberAs('VIEWER'));
    expect(await addCommentAction('slug', 't1', 'hi')).toEqual({ ok: false, error: 'Sin permisos' });
  });

  it('rejects an empty comment', async () => {
    expect(await addCommentAction('slug', 't1', '   ')).toEqual({ ok: false, error: 'Comentario vacío' });
  });

  it('creates the comment + activity', async () => {
    const res = await addCommentAction('slug', 't1', '  hello  ');
    expect(txMock.taskComment.create).toHaveBeenCalledWith({
      data: { taskId: 't1', authorId: 'u1', body: 'hello' },
    });
    expect(res).toEqual({ ok: true });
  });
});

describe('deleteTaskAction', () => {
  it('rejects non OWNER/ADMIN', async () => {
    prismaMock.project.findUnique.mockResolvedValue(memberAs('MEMBER'));
    const res = await deleteTaskAction('slug', 't1');
    expect(res).toEqual({ ok: false, error: 'Solo OWNER/ADMIN puede eliminar tareas' });
  });

  it('rejects an unknown task', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null);
    expect(await deleteTaskAction('slug', 't1')).toEqual({ ok: false, error: 'Tarea no encontrada' });
  });

  it('deletes the task', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 't1', projectId: 'p1' });
    const res = await deleteTaskAction('slug', 't1');
    expect(prismaMock.task.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    expect(res).toEqual({ ok: true });
  });
});
