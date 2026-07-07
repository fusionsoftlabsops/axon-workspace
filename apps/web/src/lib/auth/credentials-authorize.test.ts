import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, verifyPasswordMock, openTotpMock, verifyTotpMock } = vi.hoisted(() => ({
  prismaMock: { user: { findUnique: vi.fn() } },
  verifyPasswordMock: vi.fn(),
  openTotpMock: vi.fn(),
  verifyTotpMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth/password', () => ({ verifyPassword: verifyPasswordMock }));
vi.mock('@/lib/auth/totp', () => ({ openTotpSecret: openTotpMock, verifyTotp: verifyTotpMock }));

import { authorizeCredentials } from './credentials-authorize';

const creds = { email: 'me@ex.com', password: 'passlongenough12' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('authorizeCredentials', () => {
  it('returns null on invalid input', async () => {
    expect(await authorizeCredentials({ email: 'bad' })).toBeNull();
  });

  it('returns null when the user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    expect(await authorizeCredentials(creds)).toBeNull();
  });

  it('rejects a federated user without passwordHash (no crash)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', passwordHash: null });
    expect(await authorizeCredentials(creds)).toBeNull();
    expect(verifyPasswordMock).not.toHaveBeenCalled();
  });

  it('returns null on wrong password', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', passwordHash: 'h' });
    verifyPasswordMock.mockResolvedValue(false);
    expect(await authorizeCredentials(creds)).toBeNull();
  });

  it('authenticates a user without TOTP', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'me@ex.com', name: 'Me', isMasterUser: false, passwordHash: 'h',
    });
    verifyPasswordMock.mockResolvedValue(true);
    expect(await authorizeCredentials(creds)).toEqual({
      id: 'u1', email: 'me@ex.com', name: 'Me', isMasterUser: false,
    });
  });

  it('throws TOTP_REQUIRED when the code is missing', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'me@ex.com', name: 'Me', isMasterUser: false,
      passwordHash: 'h', totpSecretEncrypted: Buffer.from([1]), totpNonce: Buffer.from([2]),
    });
    verifyPasswordMock.mockResolvedValue(true);
    await expect(authorizeCredentials(creds)).rejects.toThrow('TOTP_REQUIRED');
  });

  it('validates a present TOTP code', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'me@ex.com', name: 'Me', isMasterUser: false,
      passwordHash: 'h', totpSecretEncrypted: Buffer.from([1]), totpNonce: Buffer.from([2]),
    });
    verifyPasswordMock.mockResolvedValue(true);
    openTotpMock.mockReturnValue('secret');
    verifyTotpMock.mockReturnValue(true);
    const res = await authorizeCredentials({ ...creds, totp: '123456' });
    expect(res).toMatchObject({ id: 'u1' });
    expect(verifyTotpMock).toHaveBeenCalledWith('secret', '123456');
  });
});
