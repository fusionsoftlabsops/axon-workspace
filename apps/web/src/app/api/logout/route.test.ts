import { describe, it, expect, vi } from 'vitest';

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('@/auth', () => ({ signOut }));

import { POST } from './route';

describe('POST /api/logout', () => {
  it('signs out and redirects to /login with 303', async () => {
    signOut.mockResolvedValue(undefined);
    const req = new Request('http://localhost/api/logout', { method: 'POST' });
    const res = await POST(req as never);
    expect(signOut).toHaveBeenCalledWith({ redirect: false });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('http://localhost/login');
  });
});
