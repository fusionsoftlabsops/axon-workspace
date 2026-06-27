import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireSessionOrToken: vi.fn(),
  projectFindUnique: vi.fn(),
  draftFindUnique: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ requireSessionOrToken: h.requireSessionOrToken }));
vi.mock('@/lib/db', () => ({ prisma: { project: { findUnique: h.projectFindUnique }, storyDraft: { findUnique: h.draftFindUnique } } }));

import { GET } from './route';

const ctx = { params: Promise.resolve({ slug: 'proj', id: 'd1' }) };
const session = { userId: 'u1', via: 'session', scopes: [], projectSlugs: [] as string[] };

function draft(over: Record<string, unknown> = {}) {
  return {
    id: 'd1', status: 'READY', errorMessage: null, provider: 'ANTHROPIC', model: 'm',
    rawInput: 'in', selectedPaths: [], citedMemoryIds: [], summary: 's',
    acceptanceCriteria: [], technicalContext: '', subtaskBreakdown: [], filesToTouch: [], risks: [],
    inputTokens: 1, outputTokens: 2, estimatedCostUsd: { toString: () => '0.01' }, durationMs: 100,
    taskId: null, parentDraftId: null, projectId: 'p1', authorId: 'u1',
    author: { id: 'u1', name: 'Au' },
    createdAt: new Date('2030-01-01'), updatedAt: new Date('2030-01-02'),
    ...over,
  };
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireSessionOrToken.mockResolvedValue({ ...session });
});

describe('GET draft by id', () => {
  it('401 auth fails', async () => {
    h.requireSessionOrToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(401);
  });
  it('404 project missing', async () => {
    h.projectFindUnique.mockResolvedValue(null);
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(404);
  });
  it('404 when draft missing or wrong project', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'ADMIN' }] });
    h.draftFindUnique.mockResolvedValue(draft({ projectId: 'other' }));
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(404);
  });
  it('403 when not the author', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'ADMIN' }] });
    h.draftFindUnique.mockResolvedValue(draft({ authorId: 'other' }));
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(403);
  });
  it('200 returns the draft', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'ADMIN' }] });
    h.draftFindUnique.mockResolvedValue(draft());
    const res = await GET(new NextRequest('http://localhost/x'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: 'd1', status: 'READY', estimatedCostUsd: '0.01' });
  });
});
