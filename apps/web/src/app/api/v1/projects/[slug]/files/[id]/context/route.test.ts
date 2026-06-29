import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  assertProjectMember: vi.fn(),
  fileFindFirst: vi.fn(),
}));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: h.assertProjectMember }));
vi.mock('@/lib/db', () => ({ prisma: { projectFile: { findFirst: h.fileFindFirst } } }));

import { GET } from './route';

const ctx = { params: Promise.resolve({ slug: 'proj', id: 'f1' }) };
const req = () => new NextRequest('http://localhost/x');

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.assertProjectMember.mockResolvedValue({ ok: true, projectId: 'p1', userId: 'u1', role: 'ADMIN' });
});

describe('GET context markdown', () => {
  it('401 when not authenticated', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: false, error: 'No autenticado' });
    expect((await GET(req(), ctx)).status).toBe(401);
  });

  it('404 when not a member', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: false, error: 'Proyecto no encontrado' });
    expect((await GET(req(), ctx)).status).toBe(404);
  });

  it('404 when the file does not exist', async () => {
    h.fileFindFirst.mockResolvedValue(null);
    expect((await GET(req(), ctx)).status).toBe(404);
  });

  it('404 when the context is not READY yet', async () => {
    h.fileFindFirst.mockResolvedValue({ name: 'spec.pdf', contextStatus: 'GENERATING', contextMarkdown: null });
    expect((await GET(req(), ctx)).status).toBe(404);
  });

  it('200 serves the markdown as a .md attachment', async () => {
    h.fileFindFirst.mockResolvedValue({ name: 'spec.pdf', contextStatus: 'READY', contextMarkdown: '# Spec\n\nhello' });
    const res = await GET(req(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('content-disposition')).toContain("spec.md");
    expect(await res.text()).toBe('# Spec\n\nhello');
  });
});
