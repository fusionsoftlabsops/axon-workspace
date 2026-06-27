import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  assertProjectMember: vi.fn(),
  fileFindFirst: vi.fn(),
  fileDelete: vi.fn(),
  audit: vi.fn(),
  getObjectBytes: vi.fn(),
  deleteObject: vi.fn(),
}));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: h.assertProjectMember }));
vi.mock('@/lib/audit', () => ({ audit: h.audit }));
vi.mock('@/lib/storage', () => ({ getObjectBytes: h.getObjectBytes, deleteObject: h.deleteObject }));
vi.mock('@/lib/db', () => ({ prisma: { projectFile: { findFirst: h.fileFindFirst, delete: h.fileDelete } } }));

import { GET, DELETE } from './route';

const ctx = { params: Promise.resolve({ slug: 'proj', id: 'f1' }) };

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.assertProjectMember.mockResolvedValue({ ok: true, projectId: 'p1', userId: 'u1', role: 'ADMIN' });
  h.deleteObject.mockResolvedValue(undefined);
});

describe('GET file bytes', () => {
  it('401 not authenticated', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: false, error: 'No autenticado' });
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(401);
  });
  it('404 not a member', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: false, error: 'Proyecto no encontrado' });
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(404);
  });
  it('404 file not found', async () => {
    h.fileFindFirst.mockResolvedValue(null);
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(404);
  });
  it('502 when storage read fails', async () => {
    h.fileFindFirst.mockResolvedValue({ name: 'a.png', mimeType: 'image/png', storageKey: 'k' });
    h.getObjectBytes.mockRejectedValue(new Error('gone'));
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(502);
  });
  it('200 streams bytes inline', async () => {
    h.fileFindFirst.mockResolvedValue({ name: 'a b.png', mimeType: 'image/png', storageKey: 'k' });
    h.getObjectBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const res = await GET(new NextRequest('http://localhost/x'), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('inline');
    expect(res.headers.get('content-type')).toBe('image/png');
  });
  it('200 forces attachment with ?download=1 and default mime', async () => {
    h.fileFindFirst.mockResolvedValue({ name: 'a.bin', mimeType: '', storageKey: 'k' });
    h.getObjectBytes.mockResolvedValue(new Uint8Array([1]));
    const res = await GET(new NextRequest('http://localhost/x?download=1'), ctx);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
  });
});

describe('DELETE file', () => {
  it('401 not authenticated', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: false, error: 'No autenticado' });
    expect((await DELETE(new NextRequest('http://localhost/x'), ctx)).status).toBe(401);
  });
  it('404 file not found', async () => {
    h.fileFindFirst.mockResolvedValue(null);
    expect((await DELETE(new NextRequest('http://localhost/x'), ctx)).status).toBe(404);
  });
  it('403 when not uploader and not owner/admin', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: true, projectId: 'p1', userId: 'u1', role: 'MEMBER' });
    h.fileFindFirst.mockResolvedValue({ id: 'f1', name: 'a', uploadedById: 'other', storageKey: 'k' });
    expect((await DELETE(new NextRequest('http://localhost/x'), ctx)).status).toBe(403);
  });
  it('200 deletes as uploader', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: true, projectId: 'p1', userId: 'u1', role: 'MEMBER' });
    h.fileFindFirst.mockResolvedValue({ id: 'f1', name: 'a', uploadedById: 'u1', storageKey: 'k' });
    const res = await DELETE(new NextRequest('http://localhost/x'), ctx);
    expect(res.status).toBe(200);
    expect(h.fileDelete).toHaveBeenCalled();
    expect(h.deleteObject).toHaveBeenCalledWith('k');
    expect(h.audit).toHaveBeenCalled();
  });
  it('200 deletes as admin (non-uploader)', async () => {
    h.fileFindFirst.mockResolvedValue({ id: 'f1', name: 'a', uploadedById: 'other', storageKey: 'k' });
    const res = await DELETE(new NextRequest('http://localhost/x'), ctx);
    expect(res.status).toBe(200);
  });
});
