import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  agentUpdate: vi.fn(),
  audit: vi.fn(),
  provisionAgent: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireApiToken: h.requireApiToken,
  tokenAllowsProject: (a: { projectSlugs: string[] }, s: string) =>
    a.projectSlugs.length === 0 || a.projectSlugs.includes(s),
}));
vi.mock('@/lib/db', () => ({
  prisma: { project: { findUnique: h.projectFindUnique }, agent: { update: h.agentUpdate } },
}));
vi.mock('@/lib/audit', () => ({ audit: h.audit }));
vi.mock('@/lib/agents/provision', () => ({ provisionAgent: h.provisionAgent }));

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
  h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'OWNER' }] });
  h.provisionAgent.mockResolvedValue({ agentId: 'ag1', userId: 'au1', tokenId: 'tk1', tokenPlain: 'ad_pk_NEW', tokenPrefix: 'ad_pk_NE' });
});

describe('POST agents (provisión vía API)', () => {
  it('401 auth fails', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await POST(req({ role: 'ARCHITECT' }), ctx)).status).toBe(401);
  });
  it('403 si el miembro no es OWNER/ADMIN (un agente MEMBER no acuña agentes)', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'MEMBER' }] });
    expect((await POST(req({ role: 'ARCHITECT' }), ctx)).status).toBe(403);
  });
  it('400 rol inválido', async () => {
    expect((await POST(req({ role: 'NOPE' }), ctx)).status).toBe(400);
  });
  it('201 aprovisiona, devuelve el token UNA vez y audita; enable activa', async () => {
    const res = await POST(req({ role: 'RELEASE', enable: true }), ctx);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, role: 'RELEASE', enabled: true, token: 'ad_pk_NEW' });
    expect(h.agentUpdate).toHaveBeenCalledWith({ where: { id: 'ag1' }, data: { enabled: true } });
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'agent.provision' }));
  });
  it('sin enable queda apagado (no toca agent.update)', async () => {
    const res = await POST(req({ role: 'REVIEWER' }), ctx);
    expect((await res.json()).enabled).toBe(false);
    expect(h.agentUpdate).not.toHaveBeenCalled();
  });
  it('409 si el rol ya existe (provisionAgent lanza)', async () => {
    h.provisionAgent.mockRejectedValue(new Error('El proyecto ya tiene un agente SM'));
    expect((await POST(req({ role: 'SM' }), ctx)).status).toBe(409);
  });
});
