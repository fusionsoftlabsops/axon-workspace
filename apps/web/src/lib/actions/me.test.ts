import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, authMock } = vi.hoisted(() => ({
  prismaMock: { user: { findUnique: vi.fn(), update: vi.fn() } },
  authMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/crypto', () => ({ toBase64: vi.fn(() => 'b64') }));

import {
  getMyGithubLogin,
  setGithubLoginAction,
  getSelfKeyMaterial,
  getSelfRecoveryMaterial,
} from './me';

const buf = (n: number) => Buffer.from([n]);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getMyGithubLogin', () => {
  it('returns null when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await getMyGithubLogin()).toBeNull();
  });

  it('returns the stored github login', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.user.findUnique.mockResolvedValue({ githubLogin: 'octocat' });
    expect(await getMyGithubLogin()).toBe('octocat');
  });

  it('returns null when the user has no login on file', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.user.findUnique.mockResolvedValue(null);
    expect(await getMyGithubLogin()).toBeNull();
  });
});

describe('setGithubLoginAction', () => {
  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await setGithubLoginAction('x')).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects an invalid github handle', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    const res = await setGithubLoginAction('-bad-');
    expect(res).toEqual({ ok: false, error: 'Usuario de GitHub inválido' });
  });

  it('saves a valid handle (stripping @)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    const res = await setGithubLoginAction('@octocat');
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { githubLogin: 'octocat' },
    });
    expect(res).toEqual({ ok: true, githubLogin: 'octocat' });
  });

  it('clears the handle when empty', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    const res = await setGithubLoginAction('   ');
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { githubLogin: null },
    });
    expect(res).toEqual({ ok: true, githubLogin: null });
  });
});

describe('getSelfKeyMaterial', () => {
  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await getSelfKeyMaterial()).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects when the user is missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.user.findUnique.mockResolvedValue(null);
    expect(await getSelfKeyMaterial()).toEqual({ ok: false, error: 'Usuario no encontrado' });
  });

  it('returns the base64 key material', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.user.findUnique.mockResolvedValue({
      publicKey: buf(1),
      encryptedPrivateKey: buf(2),
      encryptedPrivKeyNonce: buf(3),
      kdfSalt: buf(4),
    });
    const res = await getSelfKeyMaterial();
    expect(res).toEqual({
      ok: true,
      data: { publicKey: 'b64', encryptedPrivateKey: 'b64', encryptedPrivKeyNonce: 'b64', kdfSalt: 'b64' },
    });
  });
});

describe('getSelfRecoveryMaterial', () => {
  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await getSelfRecoveryMaterial()).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects when the user is missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.user.findUnique.mockResolvedValue(null);
    expect(await getSelfRecoveryMaterial()).toEqual({ ok: false, error: 'Usuario no encontrado' });
  });

  it('rejects when recovery is not configured', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.user.findUnique.mockResolvedValue({
      publicKey: buf(1),
      encryptedPrivKeyRecovery: null,
      recoveryPrivKeyNonce: null,
      recoveryKdfSalt: null,
    });
    const res = await getSelfRecoveryMaterial();
    expect(res.ok).toBe(false);
  });

  it('returns the recovery material', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.user.findUnique.mockResolvedValue({
      publicKey: buf(1),
      encryptedPrivKeyRecovery: buf(2),
      recoveryPrivKeyNonce: buf(3),
      recoveryKdfSalt: buf(4),
    });
    const res = await getSelfRecoveryMaterial();
    expect(res).toMatchObject({ ok: true, data: { publicKey: 'b64' } });
  });
});
