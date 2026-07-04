import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  taskFindUnique: vi.fn(),
  audit: vi.fn(),
  refineTaskForReadiness: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireApiToken: h.requireApiToken,
  tokenAllowsProject: (a: { projectSlugs: string[] }, s: string) =>
    a.projectSlugs.length === 0 || a.projectSlugs.includes(s),
}));
vi.mock('@/lib/db', () => ({
  prisma: { project: { findUnique: h.projectFindUnique }, task: { findUnique: h.taskFindUnique } },
}));
vi.mock('@/lib/audit', () => ({ audit: h.audit }));
vi.mock('@/lib/agents/refine', () => ({ refineTaskForReadiness: h.refineTaskForReadiness }));

import { POST } from './route';

const ctx = { params: Promise.resolve({ slug: 'proj', taskNumber: '30' }) };
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
  h.taskFindUnique.mockResolvedValue({ id: 'task-30' });
});

describe('POST refine', () => {
  it('401 auth fails', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await POST(req({}), ctx)).status).toBe(401);
  });
  it('403 not scoped', async () => {
    h.requireApiToken.mockResolvedValue({ ...authd, projectSlugs: ['other'] });
    expect((await POST(req({}), ctx)).status).toBe(403);
  });
  it('404 task missing', async () => {
    h.taskFindUnique.mockResolvedValue(null);
    expect((await POST(req({}), ctx)).status).toBe(404);
  });
  it('403 viewer cannot refine', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'VIEWER' }] });
    expect((await POST(req({}), ctx)).status).toBe(403);
  });
  it('201 refines + audits', async () => {
    h.refineTaskForReadiness.mockResolvedValue({ description: 'd', acceptanceCriteria: '- [ ] c', priority: 'HIGH' });
    const res = await POST(req({ lang: 'es' }), ctx);
    expect(res.status).toBe(201);
    expect((await res.json()).refinement).toMatchObject({ acceptanceCriteria: '- [ ] c', priority: 'HIGH' });
    expect(h.refineTaskForReadiness).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', taskId: 'task-30', actorUserId: 'u1', lang: 'es' }),
    );
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'task.refine' }));
  });
  it('502 when the AI generation fails', async () => {
    h.refineTaskForReadiness.mockRejectedValue(new Error('IA caída'));
    expect((await POST(req({}), ctx)).status).toBe(502);
  });
});
