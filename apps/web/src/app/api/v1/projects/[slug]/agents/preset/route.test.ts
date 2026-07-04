import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  audit: vi.fn(),
  provisionDefaultTeam: vi.fn(),
  applyTeamPreset: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ requireApiToken: h.requireApiToken, tokenAllowsProject: () => true }));
vi.mock('@/lib/db', () => ({ prisma: { project: { findUnique: h.projectFindUnique } } }));
vi.mock('@/lib/audit', () => ({ audit: h.audit }));
vi.mock('@/lib/actions/agents', () => ({
  provisionDefaultTeam: h.provisionDefaultTeam,
  applyTeamPreset: h.applyTeamPreset,
}));

import { POST } from './route';

const ctx = { params: Promise.resolve({ slug: 'forgeia' }) };
const req = (body: unknown) =>
  new NextRequest('http://localhost/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireApiToken.mockResolvedValue({ userId: 'u1', scopes: [], projectSlugs: [] });
  h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'OWNER' }] });
  h.provisionDefaultTeam.mockResolvedValue({ provisioned: 9, enabled: 9, agents: [] });
  h.applyTeamPreset.mockResolvedValue({ agents: [], minted: [], provisioned: 5 });
});

describe('POST agents/preset', () => {
  it('403 para MEMBER', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'MEMBER' }] });
    expect((await POST(req({ preset: 'AXON_DEFAULT' }), ctx)).status).toBe(403);
  });
  it('AXON_DEFAULT provisiona el equipo por defecto', async () => {
    const res = await POST(req({ preset: 'AXON_DEFAULT' }), ctx);
    expect(res.status).toBe(200);
    expect(h.provisionDefaultTeam).toHaveBeenCalledWith('p1', 'forgeia');
    expect((await res.json()).provisioned).toBe(9);
  });
  it('un preset nombrado usa applyTeamPreset', async () => {
    const res = await POST(req({ preset: 'BALANCED' }), ctx);
    expect(res.status).toBe(200);
    expect(h.applyTeamPreset).toHaveBeenCalledWith('p1', 'forgeia', 'BALANCED');
  });
  it('default sin body = AXON_DEFAULT', async () => {
    await POST(req({}), ctx);
    expect(h.provisionDefaultTeam).toHaveBeenCalled();
  });
});
