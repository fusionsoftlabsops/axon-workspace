import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({ assertProjectMember: vi.fn(), planFindFirst: vi.fn() }));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: h.assertProjectMember }));
vi.mock('@/lib/db', () => ({ prisma: { projectPlan: { findFirst: h.planFindFirst } } }));

import { GET } from './route';

const ctx = { params: Promise.resolve({ slug: 'proj' }) };

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.assertProjectMember.mockResolvedValue({ ok: true, projectId: 'p1', userId: 'u1', role: 'ADMIN' });
});

describe('GET plan', () => {
  it('401 not authenticated', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: false, error: 'No autenticado' });
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(401);
  });
  it('404 not a member', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: false, error: 'Proyecto no encontrado' });
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(404);
  });
  it('200 with null plan when none exists', async () => {
    h.planFindFirst.mockResolvedValue(null);
    const res = await GET(new NextRequest('http://localhost/x'), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plan: null });
  });
  it('200 returns the plan snapshot', async () => {
    const plan = { id: 'pl1', status: 'READY', messages: [], generated: {}, attachments: [] };
    h.planFindFirst.mockResolvedValue(plan);
    const res = await GET(new NextRequest('http://localhost/x'), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).plan).toMatchObject({ id: 'pl1', status: 'READY' });
  });
});
