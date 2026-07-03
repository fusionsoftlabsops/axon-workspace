import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  requireSessionOrToken: vi.fn(),
  publish: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ requireSessionOrToken: h.requireSessionOrToken }));
vi.mock('@/lib/actions/stories', () => ({ publishStoryDraftAsTaskAction: h.publish }));

import { POST } from './route';

const ctx = { params: Promise.resolve({ slug: 'proj', id: 'd1' }) };
const session = { userId: 'u1', via: 'session', scopes: [], projectSlugs: [] as string[] };
function req(body: unknown) {
  return new NextRequest('http://localhost/x', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const valid = { stateId: 'clabcdefghijklmnopqrstuvwx', includeSubtasks: [0, 1] };

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.requireSessionOrToken.mockResolvedValue({ ...session });
});

describe('POST publish draft', () => {
  it('401 auth fails', async () => {
    h.requireSessionOrToken.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await POST(req(valid), ctx)).status).toBe(401);
  });
  it('400 invalid body', async () => {
    expect((await POST(req({ stateId: 'not-a-cuid' }), ctx)).status).toBe(400);
  });
  it('400 when action fails', async () => {
    h.publish.mockResolvedValue({ ok: false, error: 'nope' });
    const res = await POST(req(valid), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('nope');
  });
  it('200 publishes as task', async () => {
    h.publish.mockResolvedValue({ ok: true, taskId: 't1', taskNumber: 5 });
    const res = await POST(req(valid), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, taskId: 't1', taskNumber: 5 });
    expect(h.publish).toHaveBeenCalledWith('d1', expect.objectContaining({ stateId: valid.stateId }), 'u1');
  });
});
