import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  prismaMock,
  authMock,
  revalidateMock,
  buildUriMock,
  genSecretMock,
  openSecretMock,
  sealSecretMock,
  verifyMock,
} = vi.hoisted(() => ({
  prismaMock: { user: { update: vi.fn(), findUnique: vi.fn() } },
  authMock: vi.fn(),
  revalidateMock: vi.fn(),
  buildUriMock: vi.fn(),
  genSecretMock: vi.fn(),
  openSecretMock: vi.fn(),
  sealSecretMock: vi.fn(),
  verifyMock: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth/totp', () => ({
  buildOtpauthUri: buildUriMock,
  generateTotpSecret: genSecretMock,
  openTotpSecret: openSecretMock,
  sealTotpSecret: sealSecretMock,
  verifyTotp: verifyMock,
}));

import { beginTotpEnrollment, confirmTotpEnrollment, disableTotp } from './totp';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('beginTotpEnrollment', () => {
  it('throws when there is no session email', async () => {
    authMock.mockResolvedValue(null);
    await expect(beginTotpEnrollment()).rejects.toThrow('UNAUTHORIZED');
  });

  it('returns a fresh secret + otpauth uri', async () => {
    authMock.mockResolvedValue({ user: { email: 'a@b.com' } });
    genSecretMock.mockReturnValue('SECRET');
    buildUriMock.mockReturnValue('otpauth://x');
    const res = await beginTotpEnrollment();
    expect(res).toEqual({ secret: 'SECRET', otpauthUri: 'otpauth://x' });
    expect(buildUriMock).toHaveBeenCalledWith('SECRET', 'a@b.com');
  });
});

describe('confirmTotpEnrollment', () => {
  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await confirmTotpEnrollment('s', '123456')).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects an incorrect code', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    verifyMock.mockReturnValue(false);
    expect(await confirmTotpEnrollment('s', '000000')).toEqual({ ok: false, error: 'Código incorrecto' });
  });

  it('persists the sealed secret on success', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    verifyMock.mockReturnValue(true);
    sealSecretMock.mockReturnValue({ ciphertext: new Uint8Array([1]), nonce: new Uint8Array([2]) });
    const res = await confirmTotpEnrollment('s', '123456');
    expect(prismaMock.user.update).toHaveBeenCalled();
    expect(revalidateMock).toHaveBeenCalledWith('/settings/2fa');
    expect(res).toEqual({ ok: true });
  });
});

describe('disableTotp', () => {
  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await disableTotp('123456')).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects when TOTP is not enabled', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.user.findUnique.mockResolvedValue({ totpSecretEncrypted: null, totpNonce: null });
    expect(await disableTotp('123456')).toEqual({ ok: false, error: 'TOTP no está habilitado' });
  });

  it('rejects an incorrect code', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1',
      totpSecretEncrypted: Buffer.from([1]),
      totpNonce: Buffer.from([2]),
    });
    openSecretMock.mockReturnValue('SECRET');
    verifyMock.mockReturnValue(false);
    expect(await disableTotp('000000')).toEqual({ ok: false, error: 'Código incorrecto' });
  });

  it('clears the secret on success', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1',
      totpSecretEncrypted: Buffer.from([1]),
      totpNonce: Buffer.from([2]),
    });
    openSecretMock.mockReturnValue('SECRET');
    verifyMock.mockReturnValue(true);
    const res = await disableTotp('123456');
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { totpSecretEncrypted: null, totpNonce: null },
    });
    expect(res).toEqual({ ok: true });
  });
});
