import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  assertMock: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  getObjectBytes: vi.fn(),
  extractText: vi.fn(),
  cleanToMarkdown: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: { projectFile: { findFirst: m.findFirst, update: m.update } } }));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: m.assertMock }));
vi.mock('@/lib/audit', () => ({ audit: m.audit }));
vi.mock('@/lib/storage', () => ({ getObjectBytes: m.getObjectBytes }));
vi.mock('@/lib/ai/extract', () => ({
  extractText: m.extractText,
  isImageMime: (mime: string) => /^image\//.test(mime),
}));
vi.mock('@/lib/ai/doc-to-markdown', () => ({ cleanToMarkdown: m.cleanToMarkdown }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));

import { setFileContextAction, generateFileContextAction } from './files';

const okCtx = { ok: true, userId: 'u1', projectId: 'p1', role: 'OWNER' as const };

/** Let the fire-and-forget background generation settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  m.assertMock.mockResolvedValue(okCtx);
  m.update.mockImplementation(async ({ data, where }: any) => ({
    id: where.id,
    isContext: data.isContext ?? false,
    contextStatus: data.contextStatus ?? 'NONE',
  }));
});

describe('generateFileContextAction', () => {
  it('rejects a VIEWER', async () => {
    m.assertMock.mockResolvedValue({ ...okCtx, role: 'VIEWER' });
    expect(await generateFileContextAction('s', 'f1')).toEqual({ ok: false, error: 'Sin permisos' });
  });

  it('rejects an unknown file', async () => {
    m.findFirst.mockResolvedValue(null);
    expect(await generateFileContextAction('s', 'f1')).toEqual({ ok: false, error: 'Archivo no encontrado' });
  });

  it('rejects images (they need no generation)', async () => {
    m.findFirst.mockResolvedValue({ id: 'f1', name: 'a.png', mimeType: 'image/png', category: 'IMAGE', contextStatus: 'NONE' });
    const r = await generateFileContextAction('s', 'f1');
    expect(r.ok).toBe(false);
  });

  it('is a no-op when already READY (no re-spend)', async () => {
    m.findFirst.mockResolvedValue({ id: 'f1', name: 'a.pdf', mimeType: 'application/pdf', category: 'PDF', contextStatus: 'READY' });
    const r = await generateFileContextAction('s', 'f1');
    expect(r.ok && r.data.contextStatus).toBe('READY');
    expect(m.update).not.toHaveBeenCalled();
  });

  it('marks GENERATING and runs extraction + markdown conversion to READY', async () => {
    m.findFirst
      // first call: the action guard
      .mockResolvedValueOnce({ id: 'f1', name: 'spec.pdf', mimeType: 'application/pdf', category: 'PDF', contextStatus: 'NONE' })
      // second call: inside the background run
      .mockResolvedValueOnce({ name: 'spec.pdf', mimeType: 'application/pdf', storageKey: 'k', extractedText: null });
    m.getObjectBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
    m.extractText.mockResolvedValue('  raw spec  ');
    m.cleanToMarkdown.mockResolvedValue('# Spec\n\nclean');

    const r = await generateFileContextAction('s', 'f1');
    expect(r.ok && r.data.contextStatus).toBe('GENERATING');
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ contextStatus: 'GENERATING' }) }));
    await flush();
    expect(m.cleanToMarkdown).toHaveBeenCalledWith('raw spec', 'spec.pdf');
    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contextStatus: 'READY', contextMarkdown: '# Spec\n\nclean' }) }),
    );
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'file.context.generate' }));
  });

  it('marks FAILED when extraction yields nothing', async () => {
    m.findFirst
      .mockResolvedValueOnce({ id: 'f1', name: 'empty.pdf', mimeType: 'application/pdf', category: 'PDF', contextStatus: 'NONE' })
      .mockResolvedValueOnce({ name: 'empty.pdf', mimeType: 'application/pdf', storageKey: 'k', extractedText: null });
    m.getObjectBytes.mockResolvedValue(new Uint8Array([]));
    m.extractText.mockResolvedValue('   ');
    await generateFileContextAction('s', 'f1');
    await flush();
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ contextStatus: 'FAILED' }) }));
    expect(m.cleanToMarkdown).not.toHaveBeenCalled();
  });
});

describe('setFileContextAction', () => {
  it('rejects a VIEWER', async () => {
    m.assertMock.mockResolvedValue({ ...okCtx, role: 'VIEWER' });
    expect(await setFileContextAction('s', 'f1', true)).toEqual({ ok: false, error: 'Sin permisos' });
  });

  it('requires a READY context before a document can be used', async () => {
    m.findFirst.mockResolvedValue({ id: 'f1', name: 'a.pdf', mimeType: 'application/pdf', category: 'PDF', contextStatus: 'NONE' });
    expect(await setFileContextAction('s', 'f1', true)).toEqual({ ok: false, error: 'Genera el contexto del archivo primero' });
  });

  it('uses a READY document and persists the decision', async () => {
    m.findFirst.mockResolvedValue({ id: 'f1', name: 'a.pdf', mimeType: 'application/pdf', category: 'PDF', contextStatus: 'READY' });
    m.update.mockResolvedValue({ id: 'f1', isContext: true, contextStatus: 'READY' });
    const r = await setFileContextAction('s', 'f1', true);
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isContext: true } }));
    expect(r.ok && r.data.isContext).toBe(true);
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'file.context.add' }));
  });

  it('uses an image directly (no generation needed)', async () => {
    m.findFirst.mockResolvedValue({ id: 'f2', name: 'shot.png', mimeType: 'image/png', category: 'IMAGE', contextStatus: 'NONE' });
    m.update.mockResolvedValue({ id: 'f2', isContext: true, contextStatus: 'NONE' });
    const r = await setFileContextAction('s', 'f2', true);
    expect(r.ok && r.data.isContext).toBe(true);
  });

  it('deselecting is allowed regardless of status', async () => {
    m.findFirst.mockResolvedValue({ id: 'f1', name: 'a.pdf', mimeType: 'application/pdf', category: 'PDF', contextStatus: 'READY' });
    m.update.mockResolvedValue({ id: 'f1', isContext: false, contextStatus: 'READY' });
    const r = await setFileContextAction('s', 'f1', false);
    expect(r.ok && r.data.isContext).toBe(false);
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'file.context.remove' }));
  });
});
