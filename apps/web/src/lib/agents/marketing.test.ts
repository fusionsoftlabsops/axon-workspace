import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  taskFindUnique: vi.fn(),
  taskUpdate: vi.fn(),
  projectFindUnique: vi.fn(),
  generateMarketingKit: vi.fn(),
  generateAndStoreProjectImage: vi.fn(),
  imageGenerationConfigured: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  prisma: { task: { findUnique: h.taskFindUnique, update: h.taskUpdate }, project: { findUnique: h.projectFindUnique } },
}));
vi.mock('@/lib/ai/planner', () => ({ generateMarketingKit: h.generateMarketingKit }));
vi.mock('@/lib/ai/image', () => ({
  generateAndStoreProjectImage: h.generateAndStoreProjectImage,
  imageGenerationConfigured: h.imageGenerationConfigured,
}));

import { marketingTaskKit } from './marketing';

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.taskFindUnique.mockResolvedValue({ taskNumber: 60, title: 'Landing', description: 'd', acceptanceCriteria: '- [ ] c' });
  h.projectFindUnique.mockResolvedValue({ name: 'axon', description: 'd' });
  h.generateMarketingKit.mockResolvedValue({ kit: 'headline + SEO', assetPrompt: 'a hero image' });
  h.imageGenerationConfigured.mockReturnValue(true);
  h.generateAndStoreProjectImage.mockResolvedValue({ fileId: 'brand1', name: 'brand.png', size: 10 });
  h.taskUpdate.mockResolvedValue({});
});

describe('marketingTaskKit', () => {
  it('genera copy + asset de marca y persiste marketingKit', async () => {
    const out = await marketingTaskKit({ projectId: 'p1', taskId: 't1', slug: 'axon', actorUserId: 'u1', lang: 'es' });
    expect(out.assetFileId).toBe('brand1');
    const data = (h.taskUpdate as ReturnType<typeof vi.fn>).mock.calls[0]![0].data;
    expect(data.marketingKit).toContain('headline + SEO');
    expect(data.marketingKit).toContain('/api/v1/projects/axon/files/brand1');
    expect(data.marketingKitAt).toBeInstanceOf(Date);
  });

  it('degrada: sin generación de imágenes persiste solo el copy', async () => {
    h.imageGenerationConfigured.mockReturnValue(false);
    const out = await marketingTaskKit({ projectId: 'p1', taskId: 't1', slug: 'axon', actorUserId: 'u1', lang: 'es' });
    expect(out.assetFileId).toBeNull();
    expect((h.taskUpdate as ReturnType<typeof vi.fn>).mock.calls[0]![0].data.marketingKit).toContain('no disponible');
  });

  it('lanza si la HU no existe', async () => {
    h.taskFindUnique.mockResolvedValue(null);
    await expect(marketingTaskKit({ projectId: 'p1', taskId: 'x', slug: 'axon', actorUserId: 'u1', lang: 'es' })).rejects.toThrow('HU no encontrada');
  });
});
