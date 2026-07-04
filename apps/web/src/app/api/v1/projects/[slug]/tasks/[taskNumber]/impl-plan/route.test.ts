import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  taskFindUnique: vi.fn(),
  audit: vi.fn(),
  generateTaskImplPlan: vi.fn(),
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
vi.mock('@/lib/ai/impl-plan', () => ({ generateTaskImplPlan: h.generateTaskImplPlan }));

import { GET, POST } from './route';

const ctx = { params: Promise.resolve({ slug: 'proj', taskNumber: '24' }) };
const authd = { userId: 'u1', tokenId: 't1', scopes: [], projectSlugs: [] as string[] };
function req(method: 'GET' | 'POST', body?: unknown) {
  return new NextRequest('http://localhost/x', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireApiToken.mockResolvedValue({ ...authd });
  h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'ADMIN' }] });
  h.taskFindUnique.mockResolvedValue({ id: 'task-24', implPlan: null, implPlanAt: null });
});

describe('GET impl-plan', () => {
  it('401 auth fails', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await GET(req('GET'), ctx)).status).toBe(401);
  });
  it('404 task missing', async () => {
    h.taskFindUnique.mockResolvedValue(null);
    expect((await GET(req('GET'), ctx)).status).toBe(404);
  });
  it('200 returns the stored plan', async () => {
    h.taskFindUnique.mockResolvedValue({ id: 'task-24', implPlan: '# Plan', implPlanAt: new Date('2026-07-04') });
    const res = await GET(req('GET'), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).implPlan).toBe('# Plan');
  });
});

describe('POST impl-plan', () => {
  it('401 auth fails', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await POST(req('POST', {}), ctx)).status).toBe(401);
  });
  it('403 not scoped', async () => {
    h.requireApiToken.mockResolvedValue({ ...authd, projectSlugs: ['other'] });
    expect((await POST(req('POST', {}), ctx)).status).toBe(403);
  });
  it('404 task missing', async () => {
    h.taskFindUnique.mockResolvedValue(null);
    expect((await POST(req('POST', {}), ctx)).status).toBe(404);
  });
  it('403 viewer cannot generate', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'VIEWER' }] });
    expect((await POST(req('POST', {}), ctx)).status).toBe(403);
  });
  it('201 generates + persists + audits', async () => {
    h.generateTaskImplPlan.mockResolvedValue('# Plan técnico');
    const res = await POST(req('POST', { lang: 'es' }), ctx);
    expect(res.status).toBe(201);
    expect((await res.json()).implPlan).toBe('# Plan técnico');
    expect(h.generateTaskImplPlan).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', taskId: 'task-24', userId: 'u1', lang: 'es' }),
    );
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'task.impl_plan' }));
  });
  it('502 when the AI generation fails', async () => {
    h.generateTaskImplPlan.mockRejectedValue(new Error('IA caída'));
    const res = await POST(req('POST', {}), ctx);
    expect(res.status).toBe(502);
  });
});
