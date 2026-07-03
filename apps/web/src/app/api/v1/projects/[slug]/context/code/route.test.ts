import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  analysisFindUnique: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireApiToken: h.requireApiToken,
  tokenAllowsProject: (a: { projectSlugs: string[] }, s: string) =>
    a.projectSlugs.length === 0 || a.projectSlugs.includes(s),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    project: { findUnique: h.projectFindUnique },
    codeAnalysis: { findUnique: h.analysisFindUnique },
  },
}));

import { GET } from './route';

const ctx = { params: Promise.resolve({ slug: 'axon' }) };
const req = () => new NextRequest('http://localhost/x');

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireApiToken.mockResolvedValue({ userId: 'u1', tokenId: 't1', scopes: [], projectSlugs: [] });
  h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'MEMBER' }] });
});

describe('GET context/code', () => {
  it('401 cuando la auth falla', async () => {
    h.requireApiToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await GET(req(), ctx)).status).toBe(401);
  });

  it('404 cuando no es miembro', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [] });
    expect((await GET(req(), ctx)).status).toBe(404);
  });

  it('estado NONE cuando no hay análisis', async () => {
    h.analysisFindUnique.mockResolvedValue(null);
    const body = await (await GET(req(), ctx)).json();
    expect(body).toEqual({ status: 'NONE', summary: null, godNodes: [], stats: null });
  });

  it('devuelve el resumen cuando está READY', async () => {
    h.analysisFindUnique.mockResolvedValue({
      status: 'READY',
      summary: 'mapa del código',
      godNodes: [{ label: 'ForgeType' }],
      stats: { nodes: 2568 },
      backend: 'deepseek',
      updatedAt: new Date('2026-07-03T00:00:00Z'),
    });
    const body = await (await GET(req(), ctx)).json();
    expect(body).toMatchObject({ status: 'READY', summary: 'mapa del código', stats: { nodes: 2568 } });
  });

  it('análisis a medias (ANALYZING) no expone datos parciales', async () => {
    h.analysisFindUnique.mockResolvedValue({ status: 'ANALYZING', summary: null, godNodes: null, stats: null });
    const body = await (await GET(req(), ctx)).json();
    expect(body.status).toBe('ANALYZING');
    expect(body.summary).toBeNull();
  });
});
