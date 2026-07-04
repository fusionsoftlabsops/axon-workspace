import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  taskFindUnique: vi.fn(),
  taskUpdate: vi.fn(),
  projectFindUnique: vi.fn(),
  generateDesignSpec: vi.fn(),
  generateAndStoreProjectImage: vi.fn(),
  imageGenerationConfigured: vi.fn(),
  publishDomainEvent: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    task: { findUnique: h.taskFindUnique, update: h.taskUpdate },
    project: { findUnique: h.projectFindUnique },
  },
}));
vi.mock('@/lib/ai/planner', () => ({ generateDesignSpec: h.generateDesignSpec }));
vi.mock('@/lib/ai/image', () => ({
  generateAndStoreProjectImage: h.generateAndStoreProjectImage,
  imageGenerationConfigured: h.imageGenerationConfigured,
}));
vi.mock('@/lib/agents/events', () => ({ publishDomainEvent: h.publishDomainEvent }));

import { designTaskForReadiness } from './design';

const TASK = {
  id: 'task-40',
  taskNumber: 40,
  title: 'Pantalla de login',
  description: 'clara',
  acceptanceCriteria: '- [ ] c',
  state: { id: 's1', name: 'Preparación', category: 'TODO' },
  assignee: { id: 'u-mcp' },
};

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.taskFindUnique.mockResolvedValue(TASK);
  h.projectFindUnique.mockResolvedValue({ name: 'axon', description: 'd' });
  h.generateDesignSpec.mockResolvedValue({ notes: 'notas de UI', mockupPrompt: 'a login screen' });
  h.imageGenerationConfigured.mockReturnValue(true);
  h.generateAndStoreProjectImage.mockResolvedValue({ fileId: 'img1', name: 'mockup.png', size: 10 });
  h.taskUpdate.mockResolvedValue({});
});

describe('designTaskForReadiness', () => {
  it('genera notas + mockup, persiste designSpec y publica story.designed', async () => {
    const out = await designTaskForReadiness({ projectId: 'p1', taskId: 'task-40', slug: 'axon', actorUserId: 'u1', lang: 'es' });
    expect(out.mockupFileId).toBe('img1');
    expect(h.generateAndStoreProjectImage).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', slug: 'axon', prompt: 'a login screen' }),
    );
    const data = (h.taskUpdate as ReturnType<typeof vi.fn>).mock.calls[0]![0].data;
    expect(data.designSpec).toContain('notas de UI');
    expect(data.designSpec).toContain('/api/v1/projects/axon/files/img1');
    expect(data.designSpecAt).toBeInstanceOf(Date);
    expect(h.publishDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'story.designed', storyNumber: 40, projectId: 'p1' }),
    );
  });

  it('degrada con gracia: sin generación de imágenes persiste solo las notas', async () => {
    h.imageGenerationConfigured.mockReturnValue(false);
    const out = await designTaskForReadiness({ projectId: 'p1', taskId: 'task-40', slug: 'axon', actorUserId: 'u1', lang: 'es' });
    expect(out.mockupFileId).toBeNull();
    expect(h.generateAndStoreProjectImage).not.toHaveBeenCalled();
    const data = (h.taskUpdate as ReturnType<typeof vi.fn>).mock.calls[0]![0].data;
    expect(data.designSpec).toContain('notas de UI');
    expect(data.designSpec).toContain('Mockup no disponible');
    expect(h.publishDomainEvent).toHaveBeenCalled();
  });

  it('si el mockup falla, sigue con las notas (no rompe)', async () => {
    h.generateAndStoreProjectImage.mockRejectedValue(new Error('gpt-image 500'));
    const out = await designTaskForReadiness({ projectId: 'p1', taskId: 'task-40', slug: 'axon', actorUserId: 'u1', lang: 'es' });
    expect(out.mockupFileId).toBeNull();
    expect(h.taskUpdate).toHaveBeenCalled();
    expect(h.publishDomainEvent).toHaveBeenCalled();
  });

  it('lanza si la HU no existe', async () => {
    h.taskFindUnique.mockResolvedValue(null);
    await expect(
      designTaskForReadiness({ projectId: 'p1', taskId: 'x', slug: 'axon', actorUserId: 'u1', lang: 'es' }),
    ).rejects.toThrow('HU no encontrada');
    expect(h.publishDomainEvent).not.toHaveBeenCalled();
  });
});
