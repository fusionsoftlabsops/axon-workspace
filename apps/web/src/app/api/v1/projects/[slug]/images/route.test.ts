import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  audit: vi.fn(),
  generateAndStoreProjectImage: vi.fn(),
  imageGenerationConfigured: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireApiToken: h.requireApiToken,
  tokenAllowsProject: (a: { projectSlugs: string[] }, s: string) =>
    a.projectSlugs.length === 0 || a.projectSlugs.includes(s),
}));
vi.mock('@/lib/db', () => ({ prisma: { project: { findUnique: h.projectFindUnique } } }));
vi.mock('@/lib/audit', () => ({ audit: h.audit }));
vi.mock('@/lib/ai/image', () => ({
  generateAndStoreProjectImage: h.generateAndStoreProjectImage,
  imageGenerationConfigured: h.imageGenerationConfigured,
}));

import { POST } from './route';

const ctx = { params: Promise.resolve({ slug: 'proj' }) };
const authd = { userId: 'u1', tokenId: 't1', scopes: [], projectSlugs: [] as string[] };
function req(body?: unknown) {
  return new NextRequest('http://localhost/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireApiToken.mockResolvedValue({ ...authd });
  h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'ADMIN' }] });
  h.imageGenerationConfigured.mockReturnValue(true);
});

describe('POST images', () => {
  it('401 auth fails', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await POST(req({ prompt: 'x hero' }), ctx)).status).toBe(401);
  });
  it('404 project missing', async () => {
    h.projectFindUnique.mockResolvedValue(null);
    expect((await POST(req({ prompt: 'x hero' }), ctx)).status).toBe(404);
  });
  it('403 viewer', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'VIEWER' }] });
    expect((await POST(req({ prompt: 'x hero' }), ctx)).status).toBe(403);
  });
  it('501 not configured', async () => {
    h.imageGenerationConfigured.mockReturnValue(false);
    expect((await POST(req({ prompt: 'x hero' }), ctx)).status).toBe(501);
  });
  it('400 invalid body', async () => {
    expect((await POST(req({ prompt: 'x' }), ctx)).status).toBe(400); // < 3 chars
  });
  it('201 generates + audits', async () => {
    h.generateAndStoreProjectImage.mockResolvedValue({ fileId: 'f1', name: 'hero.png', size: 100 });
    const res = await POST(req({ prompt: 'hero cyberpunk', size: '1536x1024' }), ctx);
    expect(res.status).toBe(201);
    expect((await res.json())).toMatchObject({ ok: true, fileId: 'f1' });
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'project.image' }));
  });
  it('502 when generation fails', async () => {
    h.generateAndStoreProjectImage.mockRejectedValue(new Error('gpt-image 500'));
    expect((await POST(req({ prompt: 'hero cyberpunk' }), ctx)).status).toBe(502);
  });
});
