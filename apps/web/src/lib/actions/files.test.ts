import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  assertMock: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  getObjectBytes: vi.fn(),
  extractText: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: { projectFile: { findFirst: m.findFirst, update: m.update } } }));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: m.assertMock }));
vi.mock('@/lib/audit', () => ({ audit: m.audit }));
vi.mock('@/lib/storage', () => ({ getObjectBytes: m.getObjectBytes }));
vi.mock('@/lib/ai/extract', () => ({
  extractText: m.extractText,
  // real-ish: png mime is an image
  isImageMime: (mime: string) => /^image\//.test(mime),
}));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));

import { setFileContextAction } from './files';

const okCtx = { ok: true, userId: 'u1', projectId: 'p1', role: 'OWNER' as const };

beforeEach(() => {
  vi.clearAllMocks();
  m.assertMock.mockResolvedValue(okCtx);
  m.update.mockImplementation(async ({ data, where }: any) => ({
    id: where.id,
    isContext: data.isContext,
    extractedText: data.extractedText ?? null,
    mimeType: 'application/pdf',
    category: 'PDF',
  }));
});

describe('setFileContextAction', () => {
  it('propagates the membership error', async () => {
    m.assertMock.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await setFileContextAction('s', 'f1', true)).toEqual({ ok: false, error: 'nope' });
  });

  it('rejects a VIEWER', async () => {
    m.assertMock.mockResolvedValue({ ...okCtx, role: 'VIEWER' });
    expect(await setFileContextAction('s', 'f1', true)).toEqual({ ok: false, error: 'Sin permisos' });
  });

  it('rejects an unknown file', async () => {
    m.findFirst.mockResolvedValue(null);
    expect(await setFileContextAction('s', 'f1', true)).toEqual({ ok: false, error: 'Archivo no encontrado' });
  });

  it('extracts and caches text when enabling a document', async () => {
    m.findFirst.mockResolvedValue({
      id: 'f1', name: 'spec.pdf', mimeType: 'application/pdf', storageKey: 'k', extractedText: null, category: 'PDF',
    });
    m.getObjectBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
    m.extractText.mockResolvedValue('  the spec  ');
    const res = await setFileContextAction('s', 'f1', true);
    expect(m.getObjectBytes).toHaveBeenCalledWith('k');
    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isContext: true, extractedText: 'the spec' }) }),
    );
    expect(res.ok && res.data.hasContent).toBe(true);
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'file.context.add' }));
  });

  it('does not extract images, but marks them as context (vision)', async () => {
    m.findFirst.mockResolvedValue({
      id: 'f2', name: 'shot.png', mimeType: 'image/png', storageKey: 'k2', extractedText: null, category: 'IMAGE',
    });
    m.update.mockResolvedValue({ id: 'f2', isContext: true, extractedText: null, mimeType: 'image/png', category: 'IMAGE' });
    const res = await setFileContextAction('s', 'f2', true);
    expect(m.getObjectBytes).not.toHaveBeenCalled();
    expect(res.ok && res.data.hasContent).toBe(true);
  });

  it('marks the file even when extraction throws (no usable content)', async () => {
    m.findFirst.mockResolvedValue({
      id: 'f3', name: 'broken.pdf', mimeType: 'application/pdf', storageKey: 'k3', extractedText: null, category: 'PDF',
    });
    m.getObjectBytes.mockRejectedValue(new Error('gone'));
    m.update.mockResolvedValue({ id: 'f3', isContext: true, extractedText: '', mimeType: 'application/pdf', category: 'PDF' });
    const res = await setFileContextAction('s', 'f3', true);
    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isContext: true, extractedText: '' }) }),
    );
    expect(res.ok && res.data.hasContent).toBe(false);
  });

  it('disconnecting does not re-extract and writes isContext false', async () => {
    m.findFirst.mockResolvedValue({
      id: 'f1', name: 'spec.pdf', mimeType: 'application/pdf', storageKey: 'k', extractedText: 'cached', category: 'PDF',
    });
    await setFileContextAction('s', 'f1', false);
    expect(m.getObjectBytes).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isContext: false } }));
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'file.context.remove' }));
  });
});
