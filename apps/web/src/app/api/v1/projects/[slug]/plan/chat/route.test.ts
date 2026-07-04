import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  planFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  runPlanChat: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ requireApiToken: h.requireApiToken, tokenAllowsProject: () => true }));
vi.mock('@/lib/db', () => ({
  prisma: {
    project: { findUnique: h.projectFindUnique },
    projectPlan: { findFirst: h.planFindFirst },
    user: { findUnique: h.userFindUnique },
  },
}));
vi.mock('@/lib/actions/planning', () => ({ runPlanChat: h.runPlanChat }));

import { GET, POST } from './route';

const ctx = { params: Promise.resolve({ slug: 'axon' }) };
const getReq = (qs = '') => new NextRequest(`http://localhost/x${qs}`);
const postReq = (body: unknown) =>
  new NextRequest('http://localhost/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireApiToken.mockResolvedValue({ userId: 'u1', scopes: [], projectSlugs: [] });
  h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'ADMIN' }] });
  h.userFindUnique.mockResolvedValue({ name: 'Manuel' });
});

describe('GET plan/chat', () => {
  it('404 si no es miembro', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [] });
    expect((await GET(getReq(), ctx)).status).toBe(404);
  });
  it('devuelve status, idea, repos y últimos mensajes (limit)', async () => {
    h.planFindFirst.mockResolvedValue({
      status: 'PUBLISHED',
      messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }],
      improvedIdea: 'idea',
      suggestedRepos: [{ name: 'web' }],
      generated: { sprints: [{ name: 'S1', tasks: [1, 2] }] },
      updatedAt: new Date('2026-07-04'),
    });
    const res = await GET(getReq('?limit=2'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.improvedIdea).toBe('idea');
    expect(body.generatedSummary).toEqual([{ name: 'S1', tasks: 2 }]);
    expect(body.messages).toHaveLength(2); // limit aplicado
  });
  it('404 sin plan', async () => {
    h.planFindFirst.mockResolvedValue(null);
    expect((await GET(getReq(), ctx)).status).toBe(404);
  });
});

describe('POST plan/chat', () => {
  it('403 viewer', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'VIEWER' }] });
    expect((await POST(postReq({ message: 'hola' }), ctx)).status).toBe(403);
  });
  it('400 body inválido', async () => {
    expect((await POST(postReq({}), ctx)).status).toBe(400);
  });
  it('llama runPlanChat y devuelve la respuesta del agente', async () => {
    h.runPlanChat.mockResolvedValue({
      ok: true,
      data: { messages: [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'buenas' }] },
    });
    const res = await POST(postReq({ message: 'hola' }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(h.runPlanChat).toHaveBeenCalledWith('p1', 'u1', 'Manuel', 'ADMIN', 'hola');
    expect(body.reply).toMatchObject({ role: 'assistant', content: 'buenas' });
  });
  it('propaga el error de runPlanChat como 400', async () => {
    h.runPlanChat.mockResolvedValue({ ok: false, error: 'Plan no encontrado' });
    const res = await POST(postReq({ message: 'hola' }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Plan no encontrado');
  });
});
