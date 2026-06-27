import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: queryRaw } }));

import { GET } from './route';

beforeEach(() => {
  queryRaw.mockReset();
});

describe('GET /api/health', () => {
  it('returns healthy when the DB query succeeds', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.db).toBe('connected');
    expect(typeof body.uptime).toBe('number');
    expect(typeof body.latencyMs).toBe('number');
  });

  it('returns 503 unhealthy when the DB query throws', async () => {
    queryRaw.mockRejectedValue(new Error('boom'));
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('unhealthy');
    expect(body.db).toBe('disconnected');
    expect(body.error).toBe('boom');
  });

  it('stringifies non-Error throwables', async () => {
    queryRaw.mockRejectedValue('plain-string');
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('plain-string');
  });
});
