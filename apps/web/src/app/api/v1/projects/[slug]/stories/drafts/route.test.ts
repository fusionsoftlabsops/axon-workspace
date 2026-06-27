import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireSessionOrToken: vi.fn(),
  projectFindUnique: vi.fn(),
  draftFindMany: vi.fn(),
  startStoryDraftAction: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ requireSessionOrToken: h.requireSessionOrToken }));
vi.mock('@/lib/actions/stories', () => ({ startStoryDraftAction: h.startStoryDraftAction }));
vi.mock('@/lib/db', () => ({ prisma: { project: { findUnique: h.projectFindUnique }, storyDraft: { findMany: h.draftFindMany } } }));

import { GET, POST } from './route';

const ctx = { params: Promise.resolve({ slug: 'proj' }) };
const session = { userId: 'u1', via: 'session', scopes: [], projectSlugs: [] as string[] };
function req(body: unknown) {
  return new NextRequest('http://localhost/x', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const validBody = {
  rawInput: 'a story that is long enough',
  provider: 'ANTHROPIC',
  model: 'claude-x',
  credentialId: 'clabcdefghijklmnopqrstuvwx',
};

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireSessionOrToken.mockResolvedValue({ ...session });
});

describe('POST drafts', () => {
  it('401 auth fails', async () => {
    h.requireSessionOrToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await POST(req(validBody), ctx)).status).toBe(401);
  });
  it('403 token not scoped', async () => {
    h.requireSessionOrToken.mockResolvedValue({ ...session, via: 'token', projectSlugs: ['other'] });
    expect((await POST(req(validBody), ctx)).status).toBe(403);
  });
  it('400 invalid body', async () => {
    expect((await POST(req({ rawInput: 'short' }), ctx)).status).toBe(400);
  });
  it('400 when action fails', async () => {
    h.startStoryDraftAction.mockResolvedValue({ ok: false, error: 'nope' });
    const res = await POST(req(validBody), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('nope');
  });
  it('201 starts a draft', async () => {
    h.startStoryDraftAction.mockResolvedValue({ ok: true, draftId: 'd1' });
    const res = await POST(req(validBody), ctx);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, draftId: 'd1' });
  });
});

describe('GET drafts', () => {
  it('401 auth fails', async () => {
    h.requireSessionOrToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(401);
  });
  it('404 project missing', async () => {
    h.projectFindUnique.mockResolvedValue(null);
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(404);
  });
  it('200 lists drafts', async () => {
    h.projectFindUnique.mockResolvedValue({ id: 'p1', members: [{ role: 'ADMIN' }] });
    h.draftFindMany.mockResolvedValue([
      {
        id: 'd1', provider: 'ANTHROPIC', model: 'm', status: 'READY', summary: 's',
        inputTokens: 1, outputTokens: 2, estimatedCostUsd: { toString: () => '0.01' },
        taskId: null, createdAt: new Date('2030-01-01'), updatedAt: new Date('2030-01-02'),
      },
    ]);
    const res = await GET(new NextRequest('http://localhost/x'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.drafts[0].estimatedCostUsd).toBe('0.01');
  });
});
