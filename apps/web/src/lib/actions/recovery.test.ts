import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, authMock, auditMock } = vi.hoisted(() => ({
  prismaMock: { user: { findUnique: vi.fn(), update: vi.fn() } },
  authMock: vi.fn(),
  auditMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));
vi.mock('@/lib/crypto', () => ({ fromBase64: vi.fn(() => new Uint8Array([1, 2, 3])) }));

import { resetPassphraseWithRecoveryAction, setRecoveryCodeAction } from './recovery';

const resetInput = {
  recoveryHash: 'deadbeef',
  encryptedPrivateKey: 'a',
  encryptedPrivKeyNonce: 'b',
  kdfSalt: 'c',
};
const setInput = {
  recoveryHash: 'deadbeef',
  encryptedPrivKeyRecovery: 'a',
  recoveryPrivKeyNonce: 'b',
  recoveryKdfSalt: 'c',
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u1' } });
});

describe('resetPassphraseWithRecoveryAction', () => {
  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await resetPassphraseWithRecoveryAction(resetInput)).toEqual({
      ok: false,
      error: 'No autenticado',
    });
  });

  it('rejects invalid input', async () => {
    const res = await resetPassphraseWithRecoveryAction({ recoveryHash: '' } as never);
    expect(res).toEqual({ ok: false, error: 'Datos inválidos' });
  });

  it('rejects when recovery is not configured', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ recoveryHash: null });
    const res = await resetPassphraseWithRecoveryAction(resetInput);
    expect(res.ok).toBe(false);
  });

  it('rejects a recovery proof mismatch', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ recoveryHash: 'feedface' });
    const res = await resetPassphraseWithRecoveryAction(resetInput);
    expect(res).toEqual({ ok: false, error: 'Código de recuperación incorrecto' });
  });

  it('resets the passphrase blob on a matching proof', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ recoveryHash: 'deadbeef' });
    const res = await resetPassphraseWithRecoveryAction(resetInput);
    expect(prismaMock.user.update).toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'vault.passphrase_reset' }),
    );
    expect(res).toEqual({ ok: true });
  });
});

describe('setRecoveryCodeAction', () => {
  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await setRecoveryCodeAction(setInput)).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects invalid input', async () => {
    const res = await setRecoveryCodeAction({ recoveryHash: '' } as never);
    expect(res).toEqual({ ok: false, error: 'Datos inválidos' });
  });

  it('persists the new recovery material', async () => {
    const res = await setRecoveryCodeAction(setInput);
    expect(prismaMock.user.update).toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'vault.recovery_code_regenerated' }),
    );
    expect(res).toEqual({ ok: true });
  });
});
