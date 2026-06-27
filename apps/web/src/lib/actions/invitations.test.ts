import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, authMock, auditMock, revalidateMock, envMock, sendMailMock, hashMock } = vi.hoisted(() => ({
  prismaMock: {
    invitation: { findUnique: vi.fn(), deleteMany: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
  authMock: vi.fn(),
  auditMock: vi.fn(),
  revalidateMock: vi.fn(),
  envMock: vi.fn(() => ({ AUTH_URL: undefined as string | undefined })),
  sendMailMock: vi.fn(),
  hashMock: vi.fn(() => 'token-hash'),
}));

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));
vi.mock('@/lib/invite-token', () => ({ hashInviteToken: hashMock }));
vi.mock('@/lib/env', () => ({ env: envMock }));
vi.mock('@/lib/mailer', () => ({ sendMail: sendMailMock }));

import {
  getInvitationByToken,
  createInvitationAction,
  listInvitationsAction,
  revokeInvitationAction,
} from './invitations';

const master = { user: { id: 'm1', isMasterUser: true } };
const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(master);
  envMock.mockReturnValue({ AUTH_URL: undefined });
});

describe('getInvitationByToken', () => {
  it('rejects an empty token', async () => {
    expect(await getInvitationByToken('')).toEqual({ ok: false, error: 'Falta el token de invitación' });
  });

  it('rejects a missing invitation', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue(null);
    expect(await getInvitationByToken('t')).toEqual({ ok: false, error: 'Invitación inválida' });
  });

  it('rejects an already-used invitation', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue({ email: 'e', acceptedAt: new Date(), expiresAt: future });
    expect(await getInvitationByToken('t')).toEqual({ ok: false, error: 'Esta invitación ya fue usada' });
  });

  it('rejects an expired invitation', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue({ email: 'e', acceptedAt: null, expiresAt: past });
    expect(await getInvitationByToken('t')).toEqual({ ok: false, error: 'La invitación expiró' });
  });

  it('returns the email for a valid token', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue({ email: 'e@x.com', acceptedAt: null, expiresAt: future });
    expect(await getInvitationByToken('t')).toEqual({ ok: true, email: 'e@x.com' });
  });
});

describe('createInvitationAction', () => {
  it('rejects a non-master', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isMasterUser: false } });
    expect(await createInvitationAction({ email: 'a@b.com' })).toEqual({ ok: false, error: 'Solo el super-admin puede invitar' });
  });

  it('rejects an invalid email', async () => {
    const res = await createInvitationAction({ email: 'bad' } as never);
    expect(res).toEqual({ ok: false, error: 'Email inválido' });
  });

  it('rejects when a user already exists', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1' });
    expect(await createInvitationAction({ email: 'a@b.com' })).toEqual({ ok: false, error: 'Ya existe una cuenta con ese email' });
  });

  it('creates an invitation without email when AUTH_URL is unset', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await createInvitationAction({ email: 'A@B.com' });
    expect(prismaMock.invitation.create).toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.emailSent).toBe(false);
  });

  it('emails the link when AUTH_URL is set', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    envMock.mockReturnValue({ AUTH_URL: 'https://axon.test/' });
    sendMailMock.mockResolvedValue(true);
    const res = await createInvitationAction({ email: 'a@b.com' });
    expect(sendMailMock).toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'invitation.create' }));
    if (res.ok) expect(res.data.emailSent).toBe(true);
  });
});

describe('listInvitationsAction', () => {
  it('rejects a non-master', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isMasterUser: false } });
    expect(await listInvitationsAction()).toEqual({ ok: false, error: 'No autorizado' });
  });

  it('maps invitation rows', async () => {
    prismaMock.invitation.findMany.mockResolvedValue([
      { id: 'i1', email: 'e', invitedBy: { name: 'M' }, expiresAt: past, acceptedAt: null, createdAt: future },
      { id: 'i2', email: 'e2', invitedBy: null, expiresAt: future, acceptedAt: future, createdAt: future },
    ]);
    const res = await listInvitationsAction();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data[0]).toMatchObject({ id: 'i1', invitedByName: 'M', expired: true });
      expect(res.data[1]).toMatchObject({ id: 'i2', invitedByName: null, expired: false });
    }
  });
});

describe('revokeInvitationAction', () => {
  it('rejects a non-master', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isMasterUser: false } });
    expect(await revokeInvitationAction('i1')).toEqual({ ok: false, error: 'No autorizado' });
  });

  it('revokes the invitation', async () => {
    const res = await revokeInvitationAction('i1');
    expect(prismaMock.invitation.deleteMany).toHaveBeenCalledWith({ where: { id: 'i1', acceptedAt: null } });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'invitation.revoke' }));
    expect(res).toEqual({ ok: true });
  });
});
