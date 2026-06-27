import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const {
  prismaMock,
  txMock,
  hashPasswordMock,
  hashInviteMock,
  signInMock,
  signOutMock,
  redirectMock,
} = vi.hoisted(() => {
  const txMock = {
    user: { create: vi.fn() },
    invitation: { updateMany: vi.fn(), findMany: vi.fn() },
    projectMember: { createMany: vi.fn() },
  };
  return {
    txMock,
    prismaMock: {
      invitation: { findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: typeof txMock) => unknown) => fn(txMock)),
    },
    hashPasswordMock: vi.fn(),
    hashInviteMock: vi.fn(() => 'token-hash'),
    signInMock: vi.fn(),
    signOutMock: vi.fn(),
    redirectMock: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth/password', () => ({ hashPassword: hashPasswordMock }));
vi.mock('@/lib/crypto', () => ({ fromBase64: vi.fn(() => new Uint8Array([1])) }));
vi.mock('@/lib/invite-token', () => ({ hashInviteToken: hashInviteMock }));
vi.mock('@/auth', () => ({ signIn: signInMock, signOut: signOutMock }));

import { signupAction, loginAction, logoutAction } from './auth';

const validSignup = {
  token: 'tok',
  email: 'me@example.com',
  name: 'Me',
  password: 'passlongenough12',
  publicKey: 'a',
  encryptedPrivateKey: 'a',
  encryptedPrivKeyNonce: 'a',
  kdfSalt: 'a',
  recoveryHash: 'a',
  encryptedPrivKeyRecovery: 'a',
  recoveryPrivKeyNonce: 'a',
  recoveryKdfSalt: 'a',
};

const future = new Date(Date.now() + 86_400_000);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof txMock) => unknown) => fn(txMock));
  hashPasswordMock.mockResolvedValue('hashed');
  txMock.user.create.mockResolvedValue({ id: 'u1' });
  txMock.invitation.updateMany.mockResolvedValue({ count: 1 });
  txMock.invitation.findMany.mockResolvedValue([]);
  txMock.projectMember.createMany.mockResolvedValue({ count: 0 });
});

describe('signupAction', () => {
  it('rejects invalid input with field errors', async () => {
    const res = await signupAction({ ...validSignup, email: 'bad' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('Datos inválidos');
      expect(res.fieldErrors).toBeDefined();
    }
  });

  it('rejects an invalid/expired/used invitation', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue(null);
    const res = await signupAction(validSignup);
    expect(res).toMatchObject({ ok: false });
  });

  it('rejects an already-accepted invitation', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue({
      id: 'i1',
      email: 'me@example.com',
      acceptedAt: new Date(),
      expiresAt: future,
    });
    const res = await signupAction(validSignup);
    expect(res).toMatchObject({ ok: false });
  });

  it('creates the user, consumes the invite and auto-joins project invites', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue({
      id: 'i1',
      email: 'Me@Example.com',
      acceptedAt: null,
      expiresAt: future,
    });
    txMock.invitation.findMany.mockResolvedValue([
      { id: 'pi1', projectId: 'pj1', projectRole: 'MEMBER' },
      { id: 'pi2', projectId: null, projectRole: null },
    ]);
    const res = await signupAction(validSignup);
    expect(txMock.user.create).toHaveBeenCalled();
    expect(txMock.projectMember.createMany).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ ok: true });
  });

  it('reports a duplicate account (P2002)', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue({
      id: 'i1',
      email: 'me@example.com',
      acceptedAt: null,
      expiresAt: future,
    });
    txMock.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5' }),
    );
    const res = await signupAction(validSignup);
    expect(res).toEqual({ ok: false, error: 'Ya existe una cuenta con ese email' });
  });

  it('reports a consumed invite race (INVITE_ALREADY_USED)', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue({
      id: 'i1',
      email: 'me@example.com',
      acceptedAt: null,
      expiresAt: future,
    });
    txMock.invitation.updateMany.mockResolvedValue({ count: 0 });
    const res = await signupAction(validSignup);
    expect(res).toEqual({ ok: false, error: 'Esta invitación ya fue usada' });
  });

  it('rethrows unexpected errors', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue({
      id: 'i1',
      email: 'me@example.com',
      acceptedAt: null,
      expiresAt: future,
    });
    txMock.user.create.mockRejectedValue(new Error('db down'));
    await expect(signupAction(validSignup)).rejects.toThrow('db down');
  });
});

describe('loginAction', () => {
  it('signs in successfully', async () => {
    signInMock.mockResolvedValue(undefined);
    const res = await loginAction('a@b.com', 'pw');
    expect(signInMock).toHaveBeenCalledWith('credentials', { email: 'a@b.com', password: 'pw', redirect: false });
    expect(res).toEqual({ ok: true });
  });

  it('passes the totp code when present', async () => {
    signInMock.mockResolvedValue(undefined);
    await loginAction('a@b.com', 'pw', '123456');
    expect(signInMock).toHaveBeenCalledWith('credentials', {
      email: 'a@b.com',
      password: 'pw',
      totp: '123456',
      redirect: false,
    });
  });

  it('maps a TOTP_REQUIRED failure', async () => {
    signInMock.mockRejectedValue(new Error('TOTP_REQUIRED'));
    expect(await loginAction('a@b.com', 'pw')).toEqual({ ok: false, error: 'TOTP_REQUIRED' });
  });

  it('maps any other failure to INVALID', async () => {
    signInMock.mockRejectedValue(new Error('CredentialsSignin'));
    expect(await loginAction('a@b.com', 'pw')).toEqual({ ok: false, error: 'INVALID' });
  });
});

describe('logoutAction', () => {
  it('signs out and redirects to /login', async () => {
    signOutMock.mockResolvedValue(undefined);
    await logoutAction();
    expect(signOutMock).toHaveBeenCalledWith({ redirect: false });
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });
});
