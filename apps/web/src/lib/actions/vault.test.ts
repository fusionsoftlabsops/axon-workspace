import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, authMock, auditMock } = vi.hoisted(() => ({
  prismaMock: { user: { findUnique: vi.fn(), update: vi.fn() } },
  authMock: vi.fn(),
  auditMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/crypto', () => ({ fromBase64: vi.fn(() => new Uint8Array([1])) }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));

import { initVaultAction } from './vault';

const validInput = {
  publicKey: 'a',
  encryptedPrivateKey: 'a',
  encryptedPrivKeyNonce: 'a',
  kdfSalt: 'a',
  recoveryHash: 'a',
  encryptedPrivKeyRecovery: 'a',
  recoveryPrivKeyNonce: 'a',
  recoveryKdfSalt: 'a',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('initVaultAction', () => {
  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await initVaultAction(validInput)).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects invalid input', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    const res = await initVaultAction({ ...validInput, publicKey: '' });
    expect(res).toEqual({ ok: false, error: 'Datos inválidos' });
  });

  it('refuses to overwrite an existing vault', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.user.findUnique.mockResolvedValue({ publicKey: Buffer.from([1]) });
    const res = await initVaultAction(validInput);
    expect(res).toEqual({ ok: false, error: 'El vault ya está inicializado' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('initializes the vault for a federated user (publicKey null)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.user.findUnique.mockResolvedValue({ publicKey: null });
    prismaMock.user.update.mockResolvedValue({ id: 'u1' });
    const res = await initVaultAction(validInput);
    expect(res).toEqual({ ok: true });
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'u1', action: 'vault.initialized' }),
    );
  });
});
