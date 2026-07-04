import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  assertProjectMember: vi.fn(),
  taskFindFirst: vi.fn(),
  getServerLang: vi.fn(),
  generateTaskImplPlan: vi.fn(),
}));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: h.assertProjectMember }));
vi.mock('@/lib/db', () => ({ prisma: { task: { findFirst: h.taskFindFirst } } }));
vi.mock('@/lib/i18n/server', () => ({ getServerLang: h.getServerLang }));
vi.mock('@/lib/ai/impl-plan', () => ({ generateTaskImplPlan: h.generateTaskImplPlan }));

import { getTaskDetailAction, generateTaskImplPlanAction } from './impl-plan';

const MEMBER = { ok: true as const, userId: 'u1', projectId: 'p1', role: 'MEMBER' as const };
const TASK = {
  id: 'task-24',
  taskNumber: 24,
  title: 'Agregar /pong',
  description: 'desc',
  acceptanceCriteria: 'crit',
  implPlan: '# Plan',
  implPlanAt: new Date('2026-07-04'),
  state: { name: 'Desarrollo' },
  assignee: { name: 'Kai' },
};

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.assertProjectMember.mockResolvedValue(MEMBER);
  h.getServerLang.mockResolvedValue('es');
});

describe('getTaskDetailAction', () => {
  it('propaga el error de membresía', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await getTaskDetailAction('axon', 'task-24')).toEqual({ ok: false, error: 'nope' });
  });
  it('404 si la HU no existe', async () => {
    h.taskFindFirst.mockResolvedValue(null);
    expect(await getTaskDetailAction('axon', 'x')).toEqual({ ok: false, error: 'HU no encontrada' });
  });
  it('devuelve el detalle con el plan de implementación', async () => {
    h.taskFindFirst.mockResolvedValue(TASK);
    const res = await getTaskDetailAction('axon', 'task-24');
    expect(res.ok && res.data).toMatchObject({ taskNumber: 24, implPlan: '# Plan', assignee: 'Kai', state: 'Desarrollo' });
  });
});

describe('generateTaskImplPlanAction', () => {
  it('bloquea a VIEWER', async () => {
    h.assertProjectMember.mockResolvedValue({ ...MEMBER, role: 'VIEWER' });
    expect(await generateTaskImplPlanAction('axon', 'task-24')).toEqual({
      ok: false,
      error: 'Sin permisos para generar',
    });
  });
  it('404 si la HU no existe', async () => {
    h.taskFindFirst.mockResolvedValue(null);
    expect(await generateTaskImplPlanAction('axon', 'x')).toEqual({ ok: false, error: 'HU no encontrada' });
  });
  it('genera y devuelve el markdown', async () => {
    h.taskFindFirst.mockResolvedValue({ id: 'task-24' });
    h.generateTaskImplPlan.mockResolvedValue('# Plan técnico');
    const res = await generateTaskImplPlanAction('axon', 'task-24');
    expect(res.ok && res.data?.implPlan).toBe('# Plan técnico');
    expect(h.generateTaskImplPlan).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', taskId: 'task-24', userId: 'u1', lang: 'es' }),
    );
  });
  it('devuelve el error de IA', async () => {
    h.taskFindFirst.mockResolvedValue({ id: 'task-24' });
    h.generateTaskImplPlan.mockRejectedValue(new Error('IA caída'));
    expect(await generateTaskImplPlanAction('axon', 'task-24')).toEqual({ ok: false, error: 'IA caída' });
  });
});
