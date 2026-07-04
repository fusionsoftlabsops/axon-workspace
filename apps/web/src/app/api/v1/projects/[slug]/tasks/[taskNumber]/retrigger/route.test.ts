import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireApiToken: vi.fn(),
  projectFindUnique: vi.fn(),
  taskFindUnique: vi.fn(),
  runFindFirst: vi.fn(),
  audit: vi.fn(),
  publishDomainEvent: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  requireApiToken: h.requireApiToken,
  tokenAllowsProject: () => true,
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    project: { findUnique: h.projectFindUnique },
    task: { findUnique: h.taskFindUnique },
    agentRun: { findFirst: h.runFindFirst },
  },
}));
vi.mock('@/lib/audit', () => ({ audit: h.audit }));
vi.mock('@/lib/agents/events', () => ({ publishDomainEvent: h.publishDomainEvent }));

import { POST } from './route';

const ctx = { params: Promise.resolve({ slug: 'axon', taskNumber: '26' }) };
function req(body?: unknown) {
  return new NextRequest('http://localhost/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireApiToken.mockResolvedValue({ userId: 'u1', scopes: [], projectSlugs: [] });
  h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'ADMIN' }] });
  h.taskFindUnique.mockResolvedValue({
    id: 't26', taskNumber: 26, assigneeId: null,
    state: { id: 's1', name: 'Preparación', category: 'OPEN' },
  });
  h.runFindFirst.mockResolvedValue(null);
});

describe('POST retrigger', () => {
  it('backlog (OPEN) → re-emite story.created', async () => {
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).refired).toBe('story.created');
    expect(h.publishDomainEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'story.created', storyNumber: 26 }));
  });
  it('en curso → story.state_changed', async () => {
    h.taskFindUnique.mockResolvedValue({
      id: 't26', taskNumber: 26, assigneeId: 'u-dev',
      state: { id: 's2', name: 'Desarrollo', category: 'IN_PROGRESS' },
    });
    const res = await POST(req(), ctx);
    expect((await res.json()).refired).toBe('story.state_changed');
  });
  it('409 si hay corrida RUNNING (sin force); force la salta', async () => {
    h.runFindFirst.mockResolvedValue({ id: 'r1' });
    expect((await POST(req(), ctx)).status).toBe(409);
    expect((await POST(req({ force: true }), ctx)).status).toBe(200);
  });
  it('403 viewer', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'VIEWER' }] });
    expect((await POST(req(), ctx)).status).toBe(403);
  });
});
