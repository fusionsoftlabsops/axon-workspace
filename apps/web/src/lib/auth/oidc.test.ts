import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), create: vi.fn() },
    project: { findMany: vi.fn() },
    projectMember: { createMany: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

import {
  buildAuthentikProvider,
  isOidcConfigured,
  authentikProvider,
  extractGroups,
  mapGroupsToMemberships,
  upsertFederatedUser,
} from './oidc';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.project.findMany.mockResolvedValue([]);
  prismaMock.projectMember.createMany.mockResolvedValue({ count: 0 });
});

describe('buildAuthentikProvider', () => {
  it('returns null when any credential is missing', () => {
    expect(buildAuthentikProvider({})).toBeNull();
    expect(buildAuthentikProvider({ id: 'a', secret: 'b' })).toBeNull();
    expect(buildAuthentikProvider({ id: 'a', issuer: 'https://i' })).toBeNull();
  });

  it('builds a provider with id `authentik` when all three are present', () => {
    const p = buildAuthentikProvider({ id: 'a', secret: 'b', issuer: 'https://id/application/o/axon/' });
    expect(p).not.toBeNull();
    expect(p!.id).toBe('authentik');
  });
});

describe('isOidcConfigured / authentikProvider (env-gated)', () => {
  const OLD_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('is disabled when env is absent', () => {
    delete process.env.AUTH_AUTHENTIK_ID;
    delete process.env.AUTH_AUTHENTIK_SECRET;
    delete process.env.AUTH_AUTHENTIK_ISSUER;
    expect(isOidcConfigured()).toBe(false);
    expect(authentikProvider()).toBeNull();
  });

  it('is enabled only with all three env vars', () => {
    process.env.AUTH_AUTHENTIK_ID = 'a';
    process.env.AUTH_AUTHENTIK_SECRET = 'b';
    process.env.AUTH_AUTHENTIK_ISSUER = 'https://id/application/o/axon/';
    expect(isOidcConfigured()).toBe(true);
    expect(authentikProvider()!.id).toBe('authentik');
  });
});

describe('extractGroups', () => {
  it('returns undefined when the claim is missing or not an array', () => {
    expect(extractGroups(null)).toBeUndefined();
    expect(extractGroups({})).toBeUndefined();
    expect(extractGroups({ groups: 'axon' })).toBeUndefined();
    expect(extractGroups({ groups: [] })).toBeUndefined();
  });

  it('returns the string group names', () => {
    expect(extractGroups({ groups: ['axon', 'infra', 42, ''] })).toEqual(['axon', 'infra']);
  });
});

describe('mapGroupsToMemberships', () => {
  it('does nothing without groups', async () => {
    await mapGroupsToMemberships('u1', undefined);
    await mapGroupsToMemberships('u1', []);
    expect(prismaMock.project.findMany).not.toHaveBeenCalled();
  });

  it('upserts a MEMBER membership per matching project (idempotent)', async () => {
    prismaMock.project.findMany.mockResolvedValue([{ id: 'pj-axon' }, { id: 'pj-infra' }]);
    await mapGroupsToMemberships('u1', ['Axon', 'infra', 'unknown']);
    expect(prismaMock.project.findMany).toHaveBeenCalledWith({
      where: { slug: { in: ['axon', 'infra', 'unknown'] } },
      select: { id: true },
    });
    expect(prismaMock.projectMember.createMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.projectMember.createMany).toHaveBeenCalledWith({
      data: { projectId: 'pj-axon', userId: 'u1', role: 'MEMBER' },
      skipDuplicates: true,
    });
  });
});

describe('upsertFederatedUser', () => {
  it('JIT-provisions a federated user WITHOUT vault material when none exists', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({ id: 'new1', isMasterUser: false });

    const res = await upsertFederatedUser({ email: 'New@Ex.com', name: ' Neo ', groups: ['axon'] });

    expect(res).toEqual({ id: 'new1', isMasterUser: false });
    const createArg = prismaMock.user.create.mock.calls[0]![0];
    expect(createArg.data.email).toBe('new@ex.com');
    expect(createArg.data.name).toBe('Neo');
    // Sin material de vault ni password: quedan undefined (⇒ null en DB).
    expect(createArg.data.passwordHash).toBeUndefined();
    expect(createArg.data.publicKey).toBeUndefined();
    expect(createArg.data.encryptedPrivateKey).toBeUndefined();
    expect(createArg.data.kdfSalt).toBeUndefined();
    // Mapea grupos.
    expect(prismaMock.project.findMany).toHaveBeenCalled();
  });

  it('links to an existing user by email (does not create)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u9', isMasterUser: true });
    const res = await upsertFederatedUser({ email: 'me@ex.com', name: 'Me' });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(res).toEqual({ id: 'u9', isMasterUser: true });
  });

  it('falls back to email as name when the profile has none', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({ id: 'n2', isMasterUser: false });
    await upsertFederatedUser({ email: 'anon@ex.com' });
    expect(prismaMock.user.create.mock.calls[0]![0].data.name).toBe('anon@ex.com');
  });
});
