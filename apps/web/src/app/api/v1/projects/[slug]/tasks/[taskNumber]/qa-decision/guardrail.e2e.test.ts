/**
 * E2E del guardarraíl anti auto-aprobación (axon#17): ejercita la RUTA
 * qa-decision con el módulo de guardarraíl REAL (selfApprovalBlockReason sin
 * mockear) — solo la DB está fabricada. Cadena completa:
 *   1. El Dev entregó (qaHandoff.submittedById = u-dev, sellado por token).
 *   2. El MISMO token (u-dev, que es un Agent) intenta approve → 403 + audit.
 *   3. El token del QA (u-qa, Agent distinto) aprueba → 200 → Hecho.
 *   4. Un humano (sin fila Agent) aprueba su propio trabajo → 200.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  taskFindUnique: vi.fn(),
  agentFindFirst: vi.fn(),
  taskUpdate: vi.fn(),
  activityCreate: vi.fn(),
  commentCreate: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
  extract: vi.fn(),
  publishEvent: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireApiToken: h.requireApiToken,
  tokenAllowsProject: () => true,
}));
vi.mock('@/lib/audit', () => ({ audit: h.audit }));
vi.mock('@/lib/actions/brain', () => ({ extractMemoriesFromTaskAction: h.extract }));
vi.mock('@/lib/agents/events', () => ({ publishDomainEvent: h.publishEvent }));
// OJO: '@/lib/agents/provision' NO se mockea — el guardarraíl corre de verdad.
vi.mock('@/lib/db', () => ({
  prisma: {
    project: { findUnique: h.projectFindUnique },
    task: { findUnique: h.taskFindUnique },
    agent: { findFirst: h.agentFindFirst },
    $transaction: h.transaction,
  },
}));

import { POST } from './route';

const ctx = { params: Promise.resolve({ slug: 'axon', taskNumber: '21' }) };

const AGENTS: Record<string, { id: string; role: string }> = {
  'u-dev': { id: 'ag-dev', role: 'DEV' },
  'u-qa': { id: 'ag-qa', role: 'QA' },
};

function req(body: unknown) {
  return new NextRequest('http://localhost/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.projectFindUnique.mockResolvedValue({
    id: 'p1',
    members: [{ role: 'MEMBER' }],
    workflows: [{ states: [
      { id: 's-dev', name: 'Desarrollo', category: 'IN_PROGRESS' },
      { id: 's-rev', name: 'Verificación', category: 'REVIEW' },
      { id: 's-done', name: 'Terminada', category: 'DONE' },
    ] }],
  });
  // La HU fue entregada por el Dev: submittedById sellado server-side.
  h.taskFindUnique.mockResolvedValue({
    id: 't21',
    stateId: 's-rev',
    assigneeId: 'u-dev',
    qaHandoff: { submittedById: 'u-dev' },
  });
  // Guardarraíl REAL: resuelve la fila Agent del actor contra la "DB".
  h.agentFindFirst.mockImplementation(async ({ where }: { where: { userId: string } }) =>
    AGENTS[where.userId] ?? null,
  );
  h.extract.mockResolvedValue({ ok: true });
  h.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      task: { update: h.taskUpdate },
      taskActivity: { create: h.activityCreate },
      taskComment: { create: h.commentCreate },
    }),
  );
});

describe('guardarraíl anti auto-aprobación (E2E de la regla real)', () => {
  it('el agente Dev NO puede aprobar la HU que él mismo entregó (403 + auditoría, sin mutación)', async () => {
    h.requireApiToken.mockResolvedValue({ userId: 'u-dev', tokenId: 'tok-dev', scopes: [], projectSlugs: [] });
    const res = await POST(req({ decision: 'approve' }), ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('no puede aprobar su propio trabajo');
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'task.self_approval_blocked', actorId: 'u-dev' }),
    );
  });

  it('el agente QA (identidad distinta) SÍ puede aprobar → Hecho', async () => {
    h.requireApiToken.mockResolvedValue({ userId: 'u-qa', tokenId: 'tok-qa', scopes: [], projectSlugs: [] });
    const res = await POST(req({ decision: 'approve', comment: 'verificado' }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ decision: 'approve', movedTo: 'Terminada' });
    expect(h.taskUpdate).toHaveBeenCalledWith({ where: { id: 't21' }, data: { stateId: 's-done' } });
  });

  it('el Dev SÍ puede RECHAZAR su propia entrega (el guardarraíl solo bloquea approve)', async () => {
    h.requireApiToken.mockResolvedValue({ userId: 'u-dev', tokenId: 'tok-dev', scopes: [], projectSlugs: [] });
    const res = await POST(req({ decision: 'reject', comment: 'encontré un bug propio' }), ctx);
    expect(res.status).toBe(200);
  });

  it('un humano (sin fila Agent) aprueba su propio trabajo sin restricción', async () => {
    h.requireApiToken.mockResolvedValue({ userId: 'u-humano', tokenId: 'tok-h', scopes: [], projectSlugs: [] });
    h.taskFindUnique.mockResolvedValue({
      id: 't21',
      stateId: 's-rev',
      assigneeId: 'u-humano',
      qaHandoff: { submittedById: 'u-humano' },
    });
    const res = await POST(req({ decision: 'approve' }), ctx);
    expect(res.status).toBe(200);
  });
});
