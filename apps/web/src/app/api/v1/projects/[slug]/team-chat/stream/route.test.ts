import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  assertProjectMember: vi.fn(),
  subscribe: vi.fn(async () => () => {}),
}));

vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: h.assertProjectMember }));
vi.mock('@/lib/realtime', () => ({
  subscribe: h.subscribe,
  teamChannel: (id: string) => `team:${id}`,
}));

import { GET } from './route';

const ctx = { params: Promise.resolve({ slug: 'proj' }) };

beforeEach(() => {
  Object.values(h).forEach((fn) => (fn as any).mockReset());
  h.assertProjectMember.mockResolvedValue({ ok: true, projectId: 'p1', userId: 'u1', role: 'ADMIN' });
  h.subscribe.mockResolvedValue(() => {});
});

describe('GET team-chat stream', () => {
  it('401 when not authenticated', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: false, error: 'No autenticado' });
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(401);
  });

  it('404 when not a member', async () => {
    h.assertProjectMember.mockResolvedValue({ ok: false, error: 'Proyecto no encontrado' });
    expect((await GET(new NextRequest('http://localhost/x'), ctx)).status).toBe(404);
  });

  it('200 opens an SSE stream and subscribes to the team channel', async () => {
    const res = await GET(new NextRequest('http://localhost/x'), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain(': connected');
    expect(h.subscribe).toHaveBeenCalledWith('team:p1', expect.any(Function));
    await reader.cancel();
  });
});
