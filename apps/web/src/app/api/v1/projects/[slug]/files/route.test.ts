import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  assertProjectMember: vi.fn(),
  fileCreate: vi.fn(),
  audit: vi.fn(),
  isStorageConfigured: vi.fn(),
  putObject: vi.fn(),
  deleteObject: vi.fn(),
}));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: h.assertProjectMember }));
vi.mock('@/lib/audit', () => ({ audit: h.audit }));
vi.mock('@/lib/files', () => ({ categorize: () => 'IMAGE', MAX_FILE_BYTES: 10 }));
vi.mock('@/lib/storage', () => ({
  isStorageConfigured: h.isStorageConfigured,
  buildKey: () => 'key/abc',
  putObject: h.putObject,
  deleteObject: h.deleteObject,
}));
vi.mock('@/lib/db', () => ({ prisma: { projectFile: { create: h.fileCreate } } }));

import { POST } from './route';

const ctx = { params: Promise.resolve({ slug: 'proj' }) };

function form(files: File[]) {
  const fd = new FormData();
  for (const f of files) fd.append('file', f);
  return new NextRequest('http://localhost/x', { method: 'POST', body: fd });
}
const smallFile = () => new File([new Uint8Array(5)], 'a.png', { type: 'image/png' });

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.assertProjectMember.mockResolvedValue({ ok: true, projectId: 'p1', userId: 'u1', role: 'ADMIN' });
  h.isStorageConfigured.mockReturnValue(true);
  h.putObject.mockResolvedValue(undefined);
  h.deleteObject.mockResolvedValue(undefined);
});

describe('POST files', () => {
  it('401 not authenticated', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: false, error: 'No autenticado' });
    expect((await POST(form([smallFile()]), ctx)).status).toBe(401);
  });
  it('404 not a member', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: false, error: 'Proyecto no encontrado' });
    expect((await POST(form([smallFile()]), ctx)).status).toBe(404);
  });
  it('403 viewer', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: true, projectId: 'p1', userId: 'u1', role: 'VIEWER' });
    expect((await POST(form([smallFile()]), ctx)).status).toBe(403);
  });
  it('503 storage not configured', async () => {
    h.isStorageConfigured.mockReturnValue(false);
    expect((await POST(form([smallFile()]), ctx)).status).toBe(503);
  });
  it('400 when not multipart', async () => {
    const req = new NextRequest('http://localhost/x', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect((await POST(req, ctx)).status).toBe(400);
  });
  it('400 when no files', async () => {
    expect((await POST(form([]), ctx)).status).toBe(400);
  });
  it('413 when a file exceeds the limit', async () => {
    const big = new File([new Uint8Array(20)], 'big.png', { type: 'image/png' });
    expect((await POST(form([big]), ctx)).status).toBe(413);
  });
  it('201 uploads and persists metadata', async () => {
    h.fileCreate.mockResolvedValue({ id: 'f1' });
    const res = await POST(form([smallFile()]), ctx);
    expect(res.status).toBe(201);
    expect((await res.json()).ids).toHaveLength(1);
    expect(h.putObject).toHaveBeenCalled();
    expect(h.audit).toHaveBeenCalled();
  });
  it('drops the orphan object and rethrows on DB failure', async () => {
    h.fileCreate.mockRejectedValue(new Error('db down'));
    await expect(POST(form([smallFile()]), ctx)).rejects.toThrow('db down');
    expect(h.deleteObject).toHaveBeenCalledWith('key/abc');
  });
});
