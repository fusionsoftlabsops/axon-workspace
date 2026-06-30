import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn() },
    passwordResetToken: { count: vi.fn(), create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
  hashPassword: vi.fn(async () => 'argon-hash'),
  hashInviteToken: vi.fn((t: string) => `hash:${t}`),
  sendMail: vi.fn(async () => true),
  env: vi.fn(() => ({ AUTH_URL: 'https://axon.test' })),
  audit: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: m.prisma }));
vi.mock('@/lib/auth/password', () => ({ hashPassword: m.hashPassword }));
vi.mock('@/lib/invite-token', () => ({ hashInviteToken: m.hashInviteToken }));
vi.mock('@/lib/mailer', () => ({ sendMail: m.sendMail }));
vi.mock('@/lib/env', () => ({ env: m.env }));
vi.mock('@/lib/audit', () => ({ audit: m.audit }));

import { requestPasswordResetAction, resetPasswordAction } from './password-reset';

const txMock = {
  passwordResetToken: { updateMany: vi.fn() },
  user: { update: vi.fn() },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.env.mockReturnValue({ AUTH_URL: 'https://axon.test' });
  m.hashPassword.mockResolvedValue('argon-hash');
  m.sendMail.mockResolvedValue(true);
  m.prisma.$transaction.mockImplementation(async (fn: (tx: typeof txMock) => unknown) => fn(txMock));
  txMock.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
});

describe('requestPasswordResetAction', () => {
  it('returns ok for an invalid email without touching the db', async () => {
    expect(await requestPasswordResetAction({ email: 'not-an-email' })).toEqual({ ok: true });
    expect(m.prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns ok and sends no email when the user does not exist (anti-enumeration)', async () => {
    m.prisma.user.findUnique.mockResolvedValue(null);
    expect(await requestPasswordResetAction({ email: 'ghost@x.com' })).toEqual({ ok: true });
    expect(m.sendMail).not.toHaveBeenCalled();
    expect(m.prisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('creates a token and emails a real user', async () => {
    m.prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    m.prisma.passwordResetToken.count.mockResolvedValue(0);
    await requestPasswordResetAction({ email: 'Real@X.com' });
    expect(m.prisma.passwordResetToken.create).toHaveBeenCalled();
    expect(m.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'real@x.com' }));
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.password_reset_request' }));
  });

  it('throttles after too many requests', async () => {
    m.prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    m.prisma.passwordResetToken.count.mockResolvedValue(3);
    await requestPasswordResetAction({ email: 'real@x.com' });
    expect(m.prisma.passwordResetToken.create).not.toHaveBeenCalled();
    expect(m.sendMail).not.toHaveBeenCalled();
  });
});

describe('resetPasswordAction', () => {
  it('rejects a short password', async () => {
    const r = await resetPasswordAction({ token: 't', password: 'short' });
    expect(r).toEqual({ ok: false, error: 'La contraseña debe tener al menos 12 caracteres' });
  });

  it('rejects an unknown/expired/used token', async () => {
    m.prisma.passwordResetToken.findUnique.mockResolvedValue(null);
    const r = await resetPasswordAction({ token: 'bad', password: 'a-good-password-1' });
    expect(r.ok).toBe(false);

    m.prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'r1',
      userId: 'u1',
      expiresAt: new Date(Date.now() - 1000),
      usedAt: null,
    });
    const r2 = await resetPasswordAction({ token: 'expired', password: 'a-good-password-1' });
    expect(r2.ok).toBe(false);
  });

  it('updates the password hash and consumes the token', async () => {
    m.prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'r1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    });
    const r = await resetPasswordAction({ token: 'good', password: 'a-good-password-1' });
    expect(r).toEqual({ ok: true });
    expect(m.hashPassword).toHaveBeenCalledWith('a-good-password-1');
    expect(txMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { passwordHash: 'argon-hash' } }),
    );
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.password_reset' }));
  });

  it('fails if the token was used concurrently', async () => {
    m.prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'r1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    });
    txMock.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(resetPasswordAction({ token: 'good', password: 'a-good-password-1' })).rejects.toThrow(
      'TOKEN_ALREADY_USED',
    );
  });
});
