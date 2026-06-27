import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  create: vi.fn(),
  headers: vi.fn(),
  headerMap: {} as Record<string, string | undefined>,
}));

vi.mock('@/lib/db', () => ({
  prisma: { auditLog: { create: h.create } },
}));

vi.mock('next/headers', () => ({
  headers: () => h.headers(),
}));

import { audit } from './audit';

beforeEach(() => {
  h.create.mockReset().mockResolvedValue({});
  h.headerMap = {};
  h.headers.mockReset().mockResolvedValue({
    get: (k: string) => h.headerMap[k] ?? null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('audit', () => {
  it('records an entry with ip from x-forwarded-for and the user agent', async () => {
    h.headerMap['x-forwarded-for'] = '1.2.3.4, 5.6.7.8';
    h.headerMap['user-agent'] = 'jest-agent';

    await audit({
      actorId: 'u1',
      action: 'project.create',
      resourceType: 'project',
      resourceId: 'p1',
      projectId: 'p1',
      payload: { foo: 'bar' },
    });

    expect(h.create).toHaveBeenCalledTimes(1);
    const data = h.create.mock.calls[0][0].data;
    expect(data.ip).toBe('1.2.3.4');
    expect(data.userAgent).toBe('jest-agent');
    expect(data.actorId).toBe('u1');
    expect(data.action).toBe('project.create');
    expect(data.payload).toEqual({ foo: 'bar' });
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', async () => {
    h.headerMap['x-real-ip'] = '9.9.9.9';

    await audit({ actorId: null, action: 'auth.login', resourceType: 'user', resourceId: 'u2' });

    const data = h.create.mock.calls[0][0].data;
    expect(data.ip).toBe('9.9.9.9');
    expect(data.userAgent).toBeNull();
    expect(data.actorId).toBeNull();
  });

  it('continues with null ip/userAgent when headers() throws', async () => {
    h.headers.mockRejectedValueOnce(new Error('no request context'));

    await audit({ actorId: 'u3', action: 'task.create', resourceType: 'task', resourceId: 't1' });

    expect(h.create).toHaveBeenCalledTimes(1);
    const data = h.create.mock.calls[0][0].data;
    expect(data.ip).toBeNull();
    expect(data.userAgent).toBeNull();
  });

  it('swallows persistence errors without throwing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.create.mockRejectedValueOnce(new Error('db down'));

    await expect(
      audit({ actorId: 'u4', action: 'file.delete', resourceType: 'file', resourceId: 'f1' }),
    ).resolves.toBeUndefined();

    expect(spy).toHaveBeenCalled();
  });
});
