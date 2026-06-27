import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  assertProjectMember: vi.fn(),
  planFindFirst: vi.fn(),
  attachmentCreate: vi.fn(),
  isStorageConfigured: vi.fn(),
  putObject: vi.fn(),
  deleteObject: vi.fn(),
  extractText: vi.fn(),
  isImageMime: vi.fn(),
}));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: h.assertProjectMember }));
vi.mock('@/lib/storage', () => ({
  isStorageConfigured: h.isStorageConfigured, putObject: h.putObject, deleteObject: h.deleteObject,
}));
vi.mock('@/lib/ai/extract', () => ({ extractText: h.extractText, isImageMime: h.isImageMime }));
vi.mock('@/lib/db', () => ({ prisma: { projectPlan: { findFirst: h.planFindFirst }, planAttachment: { create: h.attachmentCreate } } }));

import { POST } from './route';

const ctx = { params: Promise.resolve({ slug: 'proj' }) };
function form(files: File[]) {
  const fd = new FormData();
  for (const f of files) fd.append('file', f);
  return new NextRequest('http://localhost/x', { method: 'POST', body: fd });
}
const img = () => new File([new Uint8Array(5)], 'a.png', { type: 'image/png' });
const doc = () => new File([new Uint8Array(5)], 'a.pdf', { type: 'application/pdf' });

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.assertProjectMember.mockResolvedValue({ ok: true, projectId: 'p1', userId: 'u1', role: 'ADMIN' });
  h.isStorageConfigured.mockReturnValue(true);
  h.putObject.mockResolvedValue(undefined);
  h.deleteObject.mockResolvedValue(undefined);
  h.planFindFirst.mockResolvedValue({ id: 'pl1' });
  h.isImageMime.mockImplementation((m: string) => m.startsWith('image/'));
  h.extractText.mockResolvedValue('extracted text');
});

describe('POST plan/attachments', () => {
  it('401 not authenticated', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: false, error: 'No autenticado' });
    expect((await POST(form([img()]), ctx)).status).toBe(401);
  });
  it('404 not a member', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: false, error: 'Proyecto no encontrado' });
    expect((await POST(form([img()]), ctx)).status).toBe(404);
  });
  it('403 viewer', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: true, projectId: 'p1', userId: 'u1', role: 'VIEWER' });
    expect((await POST(form([img()]), ctx)).status).toBe(403);
  });
  it('503 storage not configured', async () => {
    h.isStorageConfigured.mockReturnValue(false);
    expect((await POST(form([img()]), ctx)).status).toBe(503);
  });
  it('404 when no plan', async () => {
    h.planFindFirst.mockResolvedValue(null);
    expect((await POST(form([img()]), ctx)).status).toBe(404);
  });
  it('400 not multipart', async () => {
    const req = new NextRequest('http://localhost/x', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect((await POST(req, ctx)).status).toBe(400);
  });
  it('400 no files', async () => {
    expect((await POST(form([]), ctx)).status).toBe(400);
  });
  it('413 over the size limit', async () => {
    const big = new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    expect((await POST(form([big]), ctx)).status).toBe(413);
  });
  it('201 stores an image (no text extraction)', async () => {
    h.attachmentCreate.mockResolvedValue({ id: 'att1' });
    const res = await POST(form([img()]), ctx);
    expect(res.status).toBe(201);
    expect((await res.json()).ids).toHaveLength(1);
    expect(h.extractText).not.toHaveBeenCalled();
    expect(h.attachmentCreate.mock.calls[0][0].data.kind).toBe('IMAGE');
  });
  it('201 stores a document and extracts text', async () => {
    h.attachmentCreate.mockResolvedValue({ id: 'att2' });
    const res = await POST(form([doc()]), ctx);
    expect(res.status).toBe(201);
    expect(h.extractText).toHaveBeenCalled();
    expect(h.attachmentCreate.mock.calls[0][0].data.kind).toBe('DOCUMENT');
    expect(h.attachmentCreate.mock.calls[0][0].data.extractedText).toBe('extracted text');
  });
  it('drops orphan object and rethrows on DB failure', async () => {
    h.attachmentCreate.mockRejectedValue(new Error('db down'));
    await expect(POST(form([img()]), ctx)).rejects.toThrow('db down');
    expect(h.deleteObject).toHaveBeenCalled();
  });
});
