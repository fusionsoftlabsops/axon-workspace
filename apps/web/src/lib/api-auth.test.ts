import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  auth: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    apiToken: { findUnique: h.findUnique, update: h.update },
  },
}));

vi.mock('@/auth', () => ({ auth: h.auth }));

import {
  generateApiToken,
  hashApiToken,
  requireApiToken,
  tokenAllowsProject,
  requireSessionOrToken,
  type AuthedRequest,
} from './api-auth';

function makeReq(authHeader?: string): NextRequest {
  return {
    headers: new Headers(authHeader ? { authorization: authHeader } : {}),
  } as unknown as NextRequest;
}

const VALID_TOKEN = 'ad_pk_abcdef0123456789';

function validTokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tok-1',
    userId: 'user-1',
    scopes: ['tasks:read', 'tasks:write'],
    projectSlugs: [],
    revokedAt: null,
    expiresAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  h.findUnique.mockReset();
  h.update.mockReset().mockReturnValue(Promise.resolve({}));
  h.auth.mockReset();
});

describe('generateApiToken / hashApiToken', () => {
  it('generates a prefixed token whose hash matches', () => {
    const { plain, hash, prefix } = generateApiToken();
    expect(plain.startsWith('ad_pk_')).toBe(true);
    expect(prefix).toBe(plain.slice(0, 12));
    expect(hash).toBe(createHash('sha256').update(plain).digest('hex'));
    expect(hashApiToken(plain)).toBe(hash);
  });

  it('hashApiToken is deterministic', () => {
    expect(hashApiToken('x')).toBe(hashApiToken('x'));
  });
});

describe('requireApiToken', () => {
  it('rejects a missing bearer header (401)', async () => {
    const res = (await requireApiToken(makeReq(), ['tasks:read' as never])) as NextResponse;
    expect(res).toBeInstanceOf(NextResponse);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'missing bearer token' });
  });

  it('rejects a non-bearer scheme (401)', async () => {
    const res = (await requireApiToken(makeReq('Basic abc'), [])) as NextResponse;
    expect(res.status).toBe(401);
  });

  it('rejects a bearer token without the ad_pk_ prefix (401)', async () => {
    const res = (await requireApiToken(makeReq('Bearer not_a_token'), [])) as NextResponse;
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid token format' });
  });

  it('rejects an unknown token (401)', async () => {
    h.findUnique.mockResolvedValue(null);
    const res = (await requireApiToken(makeReq(`Bearer ${VALID_TOKEN}`), [])) as NextResponse;
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid or revoked token' });
  });

  it('rejects a revoked token (401)', async () => {
    h.findUnique.mockResolvedValue(validTokenRow({ revokedAt: new Date() }));
    const res = (await requireApiToken(makeReq(`Bearer ${VALID_TOKEN}`), [])) as NextResponse;
    expect(res.status).toBe(401);
  });

  it('rejects an expired token (401)', async () => {
    h.findUnique.mockResolvedValue(validTokenRow({ expiresAt: new Date(Date.now() - 1000) }));
    const res = (await requireApiToken(makeReq(`Bearer ${VALID_TOKEN}`), [])) as NextResponse;
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'token expired' });
  });

  it('rejects when a required scope is missing (403)', async () => {
    h.findUnique.mockResolvedValue(validTokenRow({ scopes: ['tasks:read'] }));
    const res = (await requireApiToken(makeReq(`Bearer ${VALID_TOKEN}`), [
      'tasks:write' as never,
    ])) as NextResponse;
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'missing scope: tasks:write' });
  });

  it('authenticates a valid token and records lastUsedAt', async () => {
    h.findUnique.mockResolvedValue(validTokenRow({ projectSlugs: ['alpha'] }));
    const auth = (await requireApiToken(makeReq(`Bearer ${VALID_TOKEN}`), [
      'tasks:read' as never,
    ])) as AuthedRequest;
    expect(auth).not.toBeInstanceOf(NextResponse);
    expect(auth.userId).toBe('user-1');
    expect(auth.tokenId).toBe('tok-1');
    expect(auth.projectSlugs).toEqual(['alpha']);
    expect(h.update).toHaveBeenCalledWith({
      where: { id: 'tok-1' },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it('swallows a failure of the best-effort lastUsedAt update', async () => {
    h.findUnique.mockResolvedValue(validTokenRow());
    h.update.mockReturnValue(Promise.reject(new Error('db hiccup')));
    const auth = (await requireApiToken(makeReq(`Bearer ${VALID_TOKEN}`), [])) as AuthedRequest;
    expect(auth.userId).toBe('user-1');
    // allow the rejected promise's .catch to run
    await Promise.resolve();
  });
});

describe('tokenAllowsProject', () => {
  const base: AuthedRequest = { userId: 'u', tokenId: 't', scopes: [], projectSlugs: [] };

  it('allows any project when projectSlugs is empty (unrestricted)', () => {
    expect(tokenAllowsProject(base, 'anything')).toBe(true);
  });

  it('allows a listed project and rejects an unlisted one', () => {
    const scoped = { ...base, projectSlugs: ['alpha', 'beta'] };
    expect(tokenAllowsProject(scoped, 'beta')).toBe(true);
    expect(tokenAllowsProject(scoped, 'gamma')).toBe(false);
  });
});

describe('requireSessionOrToken', () => {
  it('returns a session-based identity when a web session is present', async () => {
    h.auth.mockResolvedValue({ user: { id: 'sess-user' } });
    const result = await requireSessionOrToken(makeReq(), ['tasks:read' as never]);
    expect(result).toEqual({
      userId: 'sess-user',
      via: 'session',
      scopes: ['tasks:read'],
      projectSlugs: [],
    });
  });

  it('falls back to a bearer token when there is no session', async () => {
    h.auth.mockResolvedValue(null);
    h.findUnique.mockResolvedValue(validTokenRow());
    const result = await requireSessionOrToken(makeReq(`Bearer ${VALID_TOKEN}`), [
      'tasks:read' as never,
    ]);
    expect(result).toMatchObject({ userId: 'user-1', via: 'token' });
  });

  it('forwards the token failure NextResponse', async () => {
    h.auth.mockResolvedValue(null);
    const result = await requireSessionOrToken(makeReq(), ['tasks:read' as never]);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });
});
