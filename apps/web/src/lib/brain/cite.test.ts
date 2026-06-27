import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const db = vi.hoisted(() => ({
  prisma: { $transaction: vi.fn() },
}));
vi.mock('@/lib/db', () => db);

import { citeMemory } from './cite';

/** A fake transaction client wired with the rows the callback will read. */
function makeTx(opts: {
  memory?: { id: string; projectId: string } | null;
  task?: { id: string; projectId: string } | null;
  citationId?: string;
}) {
  return {
    brainMemory: {
      findUnique: vi.fn().mockResolvedValue(opts.memory ?? null),
      update: vi.fn().mockResolvedValue({}),
    },
    task: { findUnique: vi.fn().mockResolvedValue(opts.task ?? null) },
    memoryCitation: { create: vi.fn().mockResolvedValue({ id: opts.citationId ?? 'c1' }) },
    taskActivity: { create: vi.fn().mockResolvedValue({}) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('citeMemory', () => {
  const input = { memoryId: 'm1', taskId: 't1', userId: 'u1', context: 'why' };

  it('records the citation, bumps counters and logs activity', async () => {
    const tx = makeTx({
      memory: { id: 'm1', projectId: 'p1' },
      task: { id: 't1', projectId: 'p1' },
      citationId: 'cit-1',
    });
    db.prisma.$transaction.mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx));

    const res = await citeMemory(input);
    expect(res).toEqual({ ok: true, citationId: 'cit-1' });
    expect(tx.memoryCitation.create).toHaveBeenCalledWith({
      data: { memoryId: 'm1', citedInTaskId: 't1', citedByUserId: 'u1', context: 'why' },
    });
    expect(tx.brainMemory.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm1' } }),
    );
    expect(tx.taskActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'MEMORY_CITED' }) }),
    );
  });

  it('fails when the memory does not exist', async () => {
    const tx = makeTx({ memory: null, task: { id: 't1', projectId: 'p1' } });
    db.prisma.$transaction.mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx));
    const res = await citeMemory(input);
    expect(res).toEqual({ ok: false, error: 'memory not found' });
  });

  it('fails when the task does not exist', async () => {
    const tx = makeTx({ memory: { id: 'm1', projectId: 'p1' }, task: null });
    db.prisma.$transaction.mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx));
    const res = await citeMemory(input);
    expect(res).toEqual({ ok: false, error: 'task not found' });
  });

  it('fails when memory and task belong to different projects', async () => {
    const tx = makeTx({
      memory: { id: 'm1', projectId: 'pA' },
      task: { id: 't1', projectId: 'pB' },
    });
    db.prisma.$transaction.mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx));
    const res = await citeMemory(input);
    expect(res).toEqual({ ok: false, error: 'memory and task belong to different projects' });
  });

  it('maps a P2003 foreign-key error to a friendly message', async () => {
    db.prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('fk', {
        code: 'P2003',
        clientVersion: 'x',
      }),
    );
    const res = await citeMemory(input);
    expect(res).toEqual({ ok: false, error: 'referencia inválida (memoria o tarea no existe)' });
  });

  it('surfaces a generic error message on unexpected failures', async () => {
    db.prisma.$transaction.mockRejectedValue(new Error('boom'));
    expect(await citeMemory(input)).toEqual({ ok: false, error: 'boom' });
  });

  it('falls back to a default message for non-Error throwables', async () => {
    db.prisma.$transaction.mockRejectedValue('weird');
    expect(await citeMemory(input)).toEqual({
      ok: false,
      error: 'no se pudo registrar la citation',
    });
  });
});
