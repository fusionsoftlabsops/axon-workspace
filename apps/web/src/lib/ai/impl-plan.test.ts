import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  taskFindUnique: vi.fn(),
  taskUpdate: vi.fn(),
  projectFindUnique: vi.fn(),
  repoFindMany: vi.fn(),
  generateImplementationPlan: vi.fn(),
  repoReaderFor: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    task: { findUnique: h.taskFindUnique, update: h.taskUpdate },
    project: { findUnique: h.projectFindUnique },
    projectRepo: { findMany: h.repoFindMany },
  },
}));
vi.mock('@/lib/ai/planner', () => ({ generateImplementationPlan: h.generateImplementationPlan }));
vi.mock('@/lib/repo/reader', () => ({ repoReaderFor: h.repoReaderFor }));

import { generateTaskImplPlan, planTaskFromTask } from './impl-plan';

const TASK = {
  id: 'task-24',
  title: 'Agregar /pong',
  description: 'responder 200',
  acceptanceCriteria: 'GET /pong → 200',
  estimate: '1d',
  estimateBySeniority: { junior: '2d', semiSenior: '1d', senior: '4h' },
  category: 'backend',
  recommendedRoles: ['backend'],
  priority: 'MEDIUM',
  kind: 'TASK',
  sprint: { name: 'S1', goal: 'meta' },
};

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.taskFindUnique.mockResolvedValue(TASK);
  h.projectFindUnique.mockResolvedValue({ name: 'axon', description: 'd', repoPath: null });
  h.repoFindMany.mockResolvedValue([]);
  h.taskUpdate.mockResolvedValue({});
  h.generateImplementationPlan.mockResolvedValue('# Plan técnico');
});

describe('planTaskFromTask', () => {
  it('mapea los campos de la HU al shape del generador', () => {
    const pt = planTaskFromTask(TASK as never);
    expect(pt).toMatchObject({
      title: 'Agregar /pong',
      acceptanceCriteria: 'GET /pong → 200',
      category: 'backend',
      priority: 'MEDIUM',
    });
  });
});

describe('generateTaskImplPlan', () => {
  it('genera desde la HU (sin repo local) y persiste en Task.implPlan', async () => {
    const md = await generateTaskImplPlan({ projectId: 'p1', taskId: 'task-24', userId: 'u1', lang: 'es' });
    expect(md).toBe('# Plan técnico');
    // Sin repoPath → no intenta leer repo.
    expect(h.repoReaderFor).not.toHaveBeenCalled();
    expect(h.generateImplementationPlan).toHaveBeenCalled();
    expect(h.taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'task-24' }, data: expect.objectContaining({ implPlan: '# Plan técnico' }) }),
    );
  });

  it('lanza si la HU no existe', async () => {
    h.taskFindUnique.mockResolvedValue(null);
    await expect(
      generateTaskImplPlan({ projectId: 'p1', taskId: 'x', userId: 'u1', lang: 'es' }),
    ).rejects.toThrow('HU no encontrada');
  });

  it('con repoPath legible: aterriza en el código (outline + archivos)', async () => {
    h.projectFindUnique.mockResolvedValue({ name: 'axon', description: 'd', repoPath: '/repo' });
    h.repoReaderFor.mockResolvedValue({
      tree: vi.fn().mockResolvedValue([{ name: 'health.ts', path: 'src/health.ts' }]),
      grep: vi.fn().mockResolvedValue([{ path: 'src/health.ts' }]),
      readFiles: vi.fn().mockResolvedValue({ files: [{ path: 'src/health.ts', content: 'x', language: 'ts', truncated: false }] }),
    });
    await generateTaskImplPlan({ projectId: 'p1', taskId: 'task-24', userId: 'u1', lang: 'es' });
    expect(h.repoReaderFor).toHaveBeenCalledWith({ repoPath: '/repo' });
    const callArgs = h.generateImplementationPlan.mock.calls[0]!;
    // El 6º arg (repoFiles) debe incluir el archivo leído.
    expect(callArgs[5]).toEqual([{ path: 'src/health.ts', content: 'x', language: 'ts', truncated: false }]);
  });
});
