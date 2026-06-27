import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  prismaMock,
  txMock,
  authMock,
  auditMock,
  assertMock,
  revalidateMock,
  citeMock,
  extractMock,
  pullMock,
  searchMock,
} = vi.hoisted(() => {
  const txMock = { brainMemory: { create: vi.fn(), update: vi.fn() } };
  return {
    txMock,
    prismaMock: {
      task: { findUnique: vi.fn() },
      brainMemory: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
      taskActivity: { create: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: typeof txMock) => unknown) => fn(txMock)),
    },
    authMock: vi.fn(),
    auditMock: vi.fn(),
    assertMock: vi.fn(),
    revalidateMock: vi.fn(),
    citeMock: vi.fn(),
    extractMock: vi.fn(),
    pullMock: vi.fn(),
    searchMock: vi.fn(),
  };
});

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: assertMock }));
vi.mock('@/lib/brain', () => ({
  citeMemory: citeMock,
  extractMemoriesFromTask: extractMock,
  pullProjectBrain: pullMock,
  searchBrain: searchMock,
}));

import {
  captureMemoryAction,
  extractMemoriesFromTaskAction,
  publishMemoryAction,
  supersedeMemoryAction,
  deprecateMemoryAction,
  searchBrainAction,
  pullProjectBrainAction,
  citeMemoryAction,
} from './brain';

const okCtx = { ok: true, userId: 'u1', projectId: 'p1', role: 'OWNER' as const };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof txMock) => unknown) => fn(txMock));
  assertMock.mockResolvedValue(okCtx);
  authMock.mockResolvedValue({ user: { id: 'u1' } });
});

describe('captureMemoryAction', () => {
  const input = { type: 'NOTE' as const, title: 't', body: 'b' };

  it('propagates the membership error', async () => {
    assertMock.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await captureMemoryAction('slug', input)).toEqual({ ok: false, error: 'nope' });
  });

  it('rejects a VIEWER', async () => {
    assertMock.mockResolvedValue({ ...okCtx, role: 'VIEWER' });
    const res = await captureMemoryAction('slug', input);
    expect(res.ok).toBe(false);
  });

  it('rejects invalid input', async () => {
    const res = await captureMemoryAction('slug', { type: 'BOGUS', title: '', body: '' } as never);
    expect(res).toEqual({ ok: false, error: 'Datos inválidos' });
  });

  it('rejects when the source task is missing', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null);
    const res = await captureMemoryAction('slug', { ...input, sourceTaskNumber: 7 });
    expect(res).toEqual({ ok: false, error: 'Tarea origen no encontrada' });
  });

  it('captures a memory (with source task) and audits', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 'task1' });
    prismaMock.brainMemory.create.mockResolvedValue({ id: 'm1' });
    const res = await captureMemoryAction('slug', { ...input, sourceTaskNumber: 7, scope: 'PROJECT' });
    expect(prismaMock.brainMemory.create).toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'brain.capture' }));
    expect(res).toEqual({ ok: true, data: { memoryId: 'm1' } });
  });
});

describe('extractMemoriesFromTaskAction', () => {
  it('rejects when there is no user', async () => {
    authMock.mockResolvedValue(null);
    const res = await extractMemoriesFromTaskAction('slug', 'task1');
    expect(res).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects when the task does not belong to the project', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 'task1', projectId: 'p1', project: { slug: 'other' } });
    const res = await extractMemoriesFromTaskAction('slug', 'task1', 'u1');
    expect(res).toEqual({ ok: false, error: 'Tarea no encontrada' });
  });

  it('extracts + persists drafts and logs activity', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 'task1', projectId: 'p1', project: { slug: 'slug' } });
    extractMock.mockResolvedValue({
      drafts: [{ type: 'NOTE', title: 't', body: 'b', tags: [] }],
      model: 'm',
      estimatedCostUsd: 0.1,
    });
    prismaMock.brainMemory.create.mockResolvedValue({ id: 'm1' });
    const res = await extractMemoriesFromTaskAction('slug', 'task1', 'u1');
    expect(prismaMock.taskActivity.create).toHaveBeenCalled();
    expect(res).toEqual({ ok: true, data: { memoryIds: ['m1'] } });
  });

  it('handles the no-drafts case without persisting', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 'task1', projectId: 'p1', project: { slug: 'slug' } });
    extractMock.mockResolvedValue({ drafts: [], model: 'm', estimatedCostUsd: 0 });
    const res = await extractMemoriesFromTaskAction('slug', 'task1', 'u1');
    expect(prismaMock.brainMemory.create).not.toHaveBeenCalled();
    expect(prismaMock.taskActivity.create).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, data: { memoryIds: [] } });
  });
});

describe('publishMemoryAction', () => {
  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await publishMemoryAction('m1')).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects a missing memory', async () => {
    prismaMock.brainMemory.findUnique.mockResolvedValue(null);
    expect(await publishMemoryAction('m1')).toEqual({ ok: false, error: 'Memoria no encontrada' });
  });

  it('rejects when the user is not in the project', async () => {
    prismaMock.brainMemory.findUnique.mockResolvedValue({
      id: 'm1', projectId: 'p1', scope: 'LOCAL', ownerUserId: 'u1', project: { slug: 's', members: [] },
    });
    expect(await publishMemoryAction('m1')).toEqual({ ok: false, error: 'Sin acceso al proyecto' });
  });

  it('rejects an already-published memory', async () => {
    prismaMock.brainMemory.findUnique.mockResolvedValue({
      id: 'm1', projectId: 'p1', scope: 'PROJECT', ownerUserId: 'u1', project: { slug: 's', members: [{ role: 'OWNER' }] },
    });
    expect(await publishMemoryAction('m1')).toEqual({ ok: false, error: 'La memoria ya está publicada' });
  });

  it('rejects when caller is neither owner nor admin', async () => {
    prismaMock.brainMemory.findUnique.mockResolvedValue({
      id: 'm1', projectId: 'p1', scope: 'LOCAL', ownerUserId: 'other', project: { slug: 's', members: [{ role: 'MEMBER' }] },
    });
    const res = await publishMemoryAction('m1');
    expect(res.ok).toBe(false);
  });

  it('publishes the memory', async () => {
    prismaMock.brainMemory.findUnique.mockResolvedValue({
      id: 'm1', projectId: 'p1', scope: 'LOCAL', ownerUserId: 'u1', project: { slug: 's', members: [{ role: 'MEMBER' }] },
    });
    const res = await publishMemoryAction('m1');
    expect(prismaMock.brainMemory.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { scope: 'PROJECT', ownerUserId: null },
    });
    expect(res).toEqual({ ok: true });
  });
});

describe('supersedeMemoryAction', () => {
  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await supersedeMemoryAction('m1', { body: 'x' })).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects a missing memory', async () => {
    prismaMock.brainMemory.findUnique.mockResolvedValue(null);
    expect(await supersedeMemoryAction('m1', { body: 'x' })).toEqual({ ok: false, error: 'Memoria no encontrada' });
  });

  it('rejects when not a project member', async () => {
    prismaMock.brainMemory.findUnique.mockResolvedValue({
      id: 'm1', projectId: 'p1', scope: 'LOCAL', ownerUserId: 'u1', title: 'old', type: 'NOTE', tags: [],
      project: { slug: 's', members: [] },
    });
    expect(await supersedeMemoryAction('m1', { body: 'x' })).toEqual({ ok: false, error: 'Sin acceso al proyecto' });
  });

  it('supersedes the memory', async () => {
    prismaMock.brainMemory.findUnique.mockResolvedValue({
      id: 'm1', projectId: 'p1', scope: 'LOCAL', ownerUserId: 'u1', title: 'old', type: 'NOTE', tags: ['a'],
      project: { slug: 's', members: [{ role: 'OWNER' }] },
    });
    txMock.brainMemory.create.mockResolvedValue({ id: 'm2' });
    const res = await supersedeMemoryAction('m1', { body: 'new' });
    expect(txMock.brainMemory.update).toHaveBeenCalled();
    expect(res).toEqual({ ok: true, data: { newMemoryId: 'm2' } });
  });
});

describe('deprecateMemoryAction', () => {
  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await deprecateMemoryAction('m1')).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects a missing memory', async () => {
    prismaMock.brainMemory.findUnique.mockResolvedValue(null);
    expect(await deprecateMemoryAction('m1')).toEqual({ ok: false, error: 'Memoria no encontrada' });
  });

  it('rejects when not a project member', async () => {
    prismaMock.brainMemory.findUnique.mockResolvedValue({
      id: 'm1', projectId: 'p1', project: { slug: 's', members: [] },
    });
    expect(await deprecateMemoryAction('m1')).toEqual({ ok: false, error: 'Sin acceso al proyecto' });
  });

  it('deprecates the memory', async () => {
    prismaMock.brainMemory.findUnique.mockResolvedValue({
      id: 'm1', projectId: 'p1', project: { slug: 's', members: [{ role: 'OWNER' }] },
    });
    const res = await deprecateMemoryAction('m1');
    expect(prismaMock.brainMemory.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { status: 'DEPRECATED' },
    });
    expect(res).toEqual({ ok: true });
  });
});

describe('searchBrainAction', () => {
  it('propagates the membership error', async () => {
    assertMock.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await searchBrainAction('slug', {})).toEqual({ ok: false, error: 'nope' });
  });

  it('rejects invalid filters', async () => {
    const res = await searchBrainAction('slug', { limit: -5 });
    expect(res).toEqual({ ok: false, error: 'Filtros inválidos' });
  });

  it('returns search results', async () => {
    searchMock.mockResolvedValue([{ id: 'm1' }]);
    const res = await searchBrainAction('slug', { query: 'x', staleOnly: true, orphansOnly: true });
    expect(searchMock).toHaveBeenCalled();
    expect(res).toEqual({ ok: true, data: [{ id: 'm1' }] });
  });
});

describe('pullProjectBrainAction', () => {
  it('propagates the membership error', async () => {
    assertMock.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await pullProjectBrainAction('slug')).toEqual({ ok: false, error: 'nope' });
  });

  it('pulls and audits', async () => {
    pullMock.mockResolvedValue({ count: 3, lastPulledAt: 'x' });
    const res = await pullProjectBrainAction('slug');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'brain.pull' }));
    expect(res).toEqual({ ok: true, data: { count: 3, lastPulledAt: 'x' } });
  });
});

describe('citeMemoryAction', () => {
  const args = { memoryId: 'm1', taskNumber: 3 };

  it('propagates the membership error', async () => {
    assertMock.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await citeMemoryAction('slug', args)).toEqual({ ok: false, error: 'nope' });
  });

  it('rejects a VIEWER', async () => {
    assertMock.mockResolvedValue({ ...okCtx, role: 'VIEWER' });
    expect(await citeMemoryAction('slug', args)).toEqual({ ok: false, error: 'Sin permisos' });
  });

  it('rejects when the task is missing', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null);
    expect(await citeMemoryAction('slug', args)).toEqual({ ok: false, error: 'Tarea no encontrada' });
  });

  it('propagates a citeMemory failure', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 'task1' });
    citeMock.mockResolvedValue({ ok: false, error: 'dup' });
    expect(await citeMemoryAction('slug', args)).toEqual({ ok: false, error: 'dup' });
  });

  it('cites the memory, audits and revalidates', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 'task1' });
    citeMock.mockResolvedValue({ ok: true });
    const res = await citeMemoryAction('slug', { ...args, context: 'ctx' });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'brain.cite' }));
    expect(res).toEqual({ ok: true });
  });
});
