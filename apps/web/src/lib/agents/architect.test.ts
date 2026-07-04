import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  taskFindUnique: vi.fn(),
  taskUpdate: vi.fn(),
  projectFindUnique: vi.fn(),
  generateTechDesign: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  prisma: { task: { findUnique: h.taskFindUnique, update: h.taskUpdate }, project: { findUnique: h.projectFindUnique } },
}));
vi.mock('@/lib/ai/planner', () => ({ generateTechDesign: h.generateTechDesign }));

import { designTaskArchitecture } from './architect';

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.taskFindUnique.mockResolvedValue({ title: 'HU', description: 'd', acceptanceCriteria: '- [ ] c', priority: 'HIGH' });
  h.projectFindUnique.mockResolvedValue({ name: 'axon', description: 'd' });
  h.generateTechDesign.mockResolvedValue('## Arquitectura\n...');
  h.taskUpdate.mockResolvedValue({});
});

describe('designTaskArchitecture', () => {
  it('genera y persiste techDesign (+ techDesignAt)', async () => {
    const out = await designTaskArchitecture({ projectId: 'p1', taskId: 't1', actorUserId: 'u1', lang: 'es' });
    expect(out).toContain('Arquitectura');
    const data = (h.taskUpdate as ReturnType<typeof vi.fn>).mock.calls[0]![0].data;
    expect(data.techDesign).toContain('Arquitectura');
    expect(data.techDesignAt).toBeInstanceOf(Date);
  });
  it('lanza si la HU no existe', async () => {
    h.taskFindUnique.mockResolvedValue(null);
    await expect(designTaskArchitecture({ projectId: 'p1', taskId: 'x', actorUserId: 'u1', lang: 'es' })).rejects.toThrow('HU no encontrada');
  });
});
