import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  assertProjectMember: vi.fn(),
  generateAndStoreProjectImage: vi.fn(),
  imageGenerationConfigured: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: h.assertProjectMember }));
vi.mock('@/lib/ai/image', () => ({
  generateAndStoreProjectImage: h.generateAndStoreProjectImage,
  imageGenerationConfigured: h.imageGenerationConfigured,
}));

import { generateProjectImageAction } from './image';

const MEMBER = { ok: true as const, userId: 'u1', projectId: 'p1', role: 'MEMBER' as const };

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.assertProjectMember.mockResolvedValue(MEMBER);
  h.imageGenerationConfigured.mockReturnValue(true);
});

describe('generateProjectImageAction', () => {
  it('propaga el error de membresía', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await generateProjectImageAction('axon', 'un hero')).toEqual({ ok: false, error: 'nope' });
  });
  it('bloquea a VIEWER', async () => {
    h.assertProjectMember.mockResolvedValue({ ...MEMBER, role: 'VIEWER' });
    expect(await generateProjectImageAction('axon', 'un hero')).toMatchObject({ ok: false });
  });
  it('error claro si no está configurado', async () => {
    h.imageGenerationConfigured.mockReturnValue(false);
    expect(await generateProjectImageAction('axon', 'un hero')).toMatchObject({ ok: false });
  });
  it('rechaza prompt vacío/corto', async () => {
    expect(await generateProjectImageAction('axon', ' ')).toMatchObject({ ok: false });
  });
  it('genera y devuelve fileId', async () => {
    h.generateAndStoreProjectImage.mockResolvedValue({ fileId: 'f1', name: 'hero.png', size: 100 });
    const res = await generateProjectImageAction('axon', 'un hero cyberpunk');
    expect(res).toEqual({ ok: true, data: { fileId: 'f1', name: 'hero.png' } });
    expect(h.generateAndStoreProjectImage).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', slug: 'axon', prompt: 'un hero cyberpunk', userId: 'u1' }),
    );
  });
  it('devuelve el error de generación', async () => {
    h.generateAndStoreProjectImage.mockRejectedValue(new Error('gpt-image 500'));
    expect(await generateProjectImageAction('axon', 'un hero')).toEqual({ ok: false, error: 'gpt-image 500' });
  });
});
