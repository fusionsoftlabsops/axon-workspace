import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  taskFindUnique: vi.fn(),
  taskUpdate: vi.fn(),
  projectFindUnique: vi.fn(),
  refineStoryForReadiness: vi.fn(),
  publishDomainEvent: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    task: { findUnique: h.taskFindUnique, update: h.taskUpdate },
    project: { findUnique: h.projectFindUnique },
    agent: { findFirst: vi.fn().mockResolvedValue({ llmModel: 'claude-haiku-4-5-20251001' }) },
  },
}));
vi.mock('@/lib/ai/planner', () => ({ refineStoryForReadiness: h.refineStoryForReadiness }));
vi.mock('@/lib/agents/events', () => ({ publishDomainEvent: h.publishDomainEvent }));

import { refineTaskForReadiness } from './refine';

const TASK = {
  id: 'task-30',
  taskNumber: 30,
  title: 'HU X',
  description: 'vieja',
  acceptanceCriteria: '',
  priority: 'LOW',
  state: { id: 's1', name: 'Preparación', category: 'TODO' },
  assignee: { id: 'u-mcp' },
};

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.taskFindUnique.mockResolvedValue(TASK);
  h.projectFindUnique.mockResolvedValue({ name: 'axon', description: 'd' });
  h.refineStoryForReadiness.mockResolvedValue({
    description: 'clara',
    acceptanceCriteria: '- [ ] criterio',
    priority: 'HIGH',
  });
  h.taskUpdate.mockResolvedValue({});
});

describe('refineTaskForReadiness', () => {
  it('genera, persiste (desc+criterios+prioridad) y publica story.refined', async () => {
    const out = await refineTaskForReadiness({ projectId: 'p1', taskId: 'task-30', actorUserId: 'u1', lang: 'es' });
    expect(out).toMatchObject({ acceptanceCriteria: '- [ ] criterio', priority: 'HIGH' });
    expect(h.taskUpdate).toHaveBeenCalledWith({
      where: { id: 'task-30' },
      data: { description: 'clara', acceptanceCriteria: '- [ ] criterio', priority: 'HIGH' },
    });
    expect(h.publishDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'story.refined', storyNumber: 30, projectId: 'p1' }),
    );
  });

  it('pasa el modelo configurado del agente al generador (cableado llmModel)', async () => {
    await refineTaskForReadiness({ projectId: 'p1', taskId: 'task-30', actorUserId: 'u1', lang: 'es' });
    expect(h.refineStoryForReadiness.mock.calls[0]!.at(-1)).toBe('claude-haiku-4-5-20251001');
  });

  it('lanza si la HU no existe', async () => {
    h.taskFindUnique.mockResolvedValue(null);
    await expect(
      refineTaskForReadiness({ projectId: 'p1', taskId: 'x', actorUserId: 'u1', lang: 'es' }),
    ).rejects.toThrow('HU no encontrada');
    expect(h.publishDomainEvent).not.toHaveBeenCalled();
  });
});
