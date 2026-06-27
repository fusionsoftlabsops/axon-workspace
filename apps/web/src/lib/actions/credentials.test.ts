import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const CUID = 'cjld2cjxh0000qzrmn831i7rn';

const { prismaMock, authMock, auditMock, revalidateMock } = vi.hoisted(() => ({
  prismaMock: {
    project: { findUnique: vi.fn() },
    projectMember: { findMany: vi.fn(), findUnique: vi.fn() },
    credential: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    credentialAccess: { create: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn((arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : (arg as (t: unknown) => unknown)({}))),
  },
  authMock: vi.fn(),
  auditMock: vi.fn(),
  revalidateMock: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));
vi.mock('@/lib/crypto', () => ({
  fromBase64: vi.fn(() => new Uint8Array([1])),
  toBase64: vi.fn(() => 'b64'),
}));

import {
  createCredentialAction,
  getCredentialAction,
  shareCredentialAction,
  revokeCredentialAccessAction,
  deleteCredentialAction,
  rotateCredentialAction,
  getProjectMemberKeys,
} from './credentials';

const projectAs = (role: string) => ({ id: 'p1', members: [{ role }] });

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u1' } });
  prismaMock.project.findUnique.mockResolvedValue(projectAs('OWNER'));
});

describe('createCredentialAction', () => {
  const input = { name: 'n', type: 'NOTE' as const, ciphertext: 'a', nonce: 'a', access: [{ userId: CUID, wrappedDek: 'a' }] };

  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await createCredentialAction('slug', input)).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects a VIEWER', async () => {
    prismaMock.project.findUnique.mockResolvedValue(projectAs('VIEWER'));
    const res = await createCredentialAction('slug', input);
    expect(res.ok).toBe(false);
  });

  it('rejects invalid input', async () => {
    const res = await createCredentialAction('slug', { name: '', type: 'NOTE', ciphertext: '', nonce: '', access: [] } as never);
    expect(res).toEqual({ ok: false, error: 'Datos inválidos' });
  });

  it('rejects when a grantee is not a member', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([]);
    const res = await createCredentialAction('slug', input);
    expect(res).toEqual({ ok: false, error: 'Hay destinatarios que no son miembros del proyecto' });
  });

  it('creates the credential, audits and revalidates', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([{ userId: CUID }]);
    prismaMock.credential.create.mockResolvedValue({ id: 'c1' });
    const res = await createCredentialAction('slug', { ...input, metadataPublic: { k: 'v' } });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'credential.create' }));
    expect(res).toEqual({ ok: true, data: { id: 'c1' } });
  });
});

describe('getCredentialAction', () => {
  it('rejects when the project is not found', async () => {
    prismaMock.project.findUnique.mockResolvedValue(null);
    expect(await getCredentialAction('slug', 'c1')).toEqual({ ok: false, error: 'Proyecto no encontrado' });
  });

  it('rejects when no access', async () => {
    prismaMock.credential.findFirst.mockResolvedValue(null);
    expect(await getCredentialAction('slug', 'c1')).toEqual({ ok: false, error: 'Credencial no encontrada o sin acceso' });
  });

  it('returns the encrypted blob + wrapped dek', async () => {
    prismaMock.credential.findFirst.mockResolvedValue({
      id: 'c1', name: 'n', type: 'NOTE', ciphertext: Buffer.from([1]), nonce: Buffer.from([2]),
      createdAt: new Date('2020-01-01T00:00:00Z'), access: [{ wrappedDek: Buffer.from([3]) }],
    });
    const res = await getCredentialAction('slug', 'c1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toMatchObject({ id: 'c1', ciphertext: 'b64', wrappedDek: 'b64' });
  });
});

describe('shareCredentialAction', () => {
  it('rejects a VIEWER', async () => {
    prismaMock.project.findUnique.mockResolvedValue(projectAs('VIEWER'));
    expect(await shareCredentialAction('slug', 'c1', 'u2', 'dek')).toEqual({ ok: false, error: 'Sin permisos' });
  });

  it('rejects when the caller has no access', async () => {
    prismaMock.credential.findFirst.mockResolvedValue(null);
    expect(await shareCredentialAction('slug', 'c1', 'u2', 'dek')).toEqual({ ok: false, error: 'No tienes acceso a esta credencial' });
  });

  it('rejects when recipient is not a member', async () => {
    prismaMock.credential.findFirst.mockResolvedValue({ id: 'c1', access: [{ id: 'a1' }] });
    prismaMock.projectMember.findUnique.mockResolvedValue(null);
    expect(await shareCredentialAction('slug', 'c1', 'u2', 'dek')).toEqual({ ok: false, error: 'Destinatario no es miembro' });
  });

  it('reports when the recipient already has access (P2002)', async () => {
    prismaMock.credential.findFirst.mockResolvedValue({ id: 'c1', access: [{ id: 'a1' }] });
    prismaMock.projectMember.findUnique.mockResolvedValue({ userId: 'u2' });
    prismaMock.credentialAccess.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5' }),
    );
    expect(await shareCredentialAction('slug', 'c1', 'u2', 'dek')).toEqual({ ok: false, error: 'Ese miembro ya tiene acceso' });
  });

  it('rethrows unexpected create errors', async () => {
    prismaMock.credential.findFirst.mockResolvedValue({ id: 'c1', access: [{ id: 'a1' }] });
    prismaMock.projectMember.findUnique.mockResolvedValue({ userId: 'u2' });
    prismaMock.credentialAccess.create.mockRejectedValue(new Error('boom'));
    await expect(shareCredentialAction('slug', 'c1', 'u2', 'dek')).rejects.toThrow('boom');
  });

  it('shares access and audits', async () => {
    prismaMock.credential.findFirst.mockResolvedValue({ id: 'c1', access: [{ id: 'a1' }] });
    prismaMock.projectMember.findUnique.mockResolvedValue({ userId: 'u2' });
    prismaMock.credentialAccess.create.mockResolvedValue({});
    const res = await shareCredentialAction('slug', 'c1', 'u2', 'dek');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'credential.share' }));
    expect(res).toEqual({ ok: true });
  });
});

describe('revokeCredentialAccessAction', () => {
  it('rejects non OWNER/ADMIN', async () => {
    prismaMock.project.findUnique.mockResolvedValue(projectAs('MEMBER'));
    expect(await revokeCredentialAccessAction('slug', 'c1', 'u2')).toEqual({ ok: false, error: 'Solo OWNER/ADMIN puede revocar' });
  });

  it('rejects a missing credential', async () => {
    prismaMock.credential.findFirst.mockResolvedValue(null);
    expect(await revokeCredentialAccessAction('slug', 'c1', 'u2')).toEqual({ ok: false, error: 'Credencial no encontrada' });
  });

  it('refuses to revoke the creator', async () => {
    prismaMock.credential.findFirst.mockResolvedValue({ id: 'c1', createdById: 'u2' });
    const res = await revokeCredentialAccessAction('slug', 'c1', 'u2');
    expect(res.ok).toBe(false);
  });

  it('revokes access and marks for rotation', async () => {
    prismaMock.credential.findFirst.mockResolvedValue({ id: 'c1', createdById: 'creator' });
    const res = await revokeCredentialAccessAction('slug', 'c1', 'u2');
    expect(prismaMock.credentialAccess.deleteMany).toHaveBeenCalled();
    expect(prismaMock.credential.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { needsRotation: true } });
    expect(res).toEqual({ ok: true });
  });
});

describe('deleteCredentialAction', () => {
  it('rejects non OWNER/ADMIN', async () => {
    prismaMock.project.findUnique.mockResolvedValue(projectAs('MEMBER'));
    expect(await deleteCredentialAction('slug', 'c1')).toEqual({ ok: false, error: 'Solo OWNER/ADMIN puede eliminar' });
  });

  it('rejects a missing credential', async () => {
    prismaMock.credential.findFirst.mockResolvedValue(null);
    expect(await deleteCredentialAction('slug', 'c1')).toEqual({ ok: false, error: 'Credencial no encontrada' });
  });

  it('deletes the credential', async () => {
    prismaMock.credential.findFirst.mockResolvedValue({ id: 'c1' });
    const res = await deleteCredentialAction('slug', 'c1');
    expect(prismaMock.credential.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    expect(res).toEqual({ ok: true });
  });
});

describe('rotateCredentialAction', () => {
  const payload = { ciphertext: 'a', nonce: 'a', access: [{ userId: CUID, wrappedDek: 'a' }] };

  it('rejects a VIEWER', async () => {
    prismaMock.project.findUnique.mockResolvedValue(projectAs('VIEWER'));
    expect(await rotateCredentialAction('slug', 'c1', payload)).toEqual({ ok: false, error: 'Sin permisos' });
  });

  it('rejects when the caller has no access', async () => {
    prismaMock.credential.findFirst.mockResolvedValue(null);
    expect(await rotateCredentialAction('slug', 'c1', payload)).toEqual({ ok: false, error: 'No tienes acceso a esta credencial' });
  });

  it('rejects an empty recipient list', async () => {
    prismaMock.credential.findFirst.mockResolvedValue({ id: 'c1', access: [{ id: 'a1' }] });
    const res = await rotateCredentialAction('slug', 'c1', { ...payload, access: [] });
    expect(res.ok).toBe(false);
  });

  it('rejects when a recipient is not a member', async () => {
    prismaMock.credential.findFirst.mockResolvedValue({ id: 'c1', access: [{ id: 'a1' }] });
    prismaMock.projectMember.findMany.mockResolvedValue([]);
    const res = await rotateCredentialAction('slug', 'c1', payload);
    expect(res).toEqual({ ok: false, error: 'Hay destinatarios que no son miembros del proyecto' });
  });

  it('rotates the credential and audits', async () => {
    prismaMock.credential.findFirst.mockResolvedValue({ id: 'c1', access: [{ id: 'a1' }] });
    prismaMock.projectMember.findMany.mockResolvedValue([{ userId: CUID }]);
    const res = await rotateCredentialAction('slug', 'c1', payload);
    expect(prismaMock.$transaction).toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'credential.rotate' }));
    expect(res).toEqual({ ok: true });
  });
});

describe('getProjectMemberKeys', () => {
  it('rejects when the project is not found', async () => {
    prismaMock.project.findUnique.mockResolvedValue(null);
    expect(await getProjectMemberKeys('slug')).toEqual({ ok: false, error: 'Proyecto no encontrado' });
  });

  it('returns member public keys', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([
      { user: { id: 'u2', name: 'N', email: 'e', publicKey: Buffer.from([1]) } },
    ]);
    const res = await getProjectMemberKeys('slug');
    expect(res).toEqual({ ok: true, data: [{ userId: 'u2', name: 'N', email: 'e', publicKey: 'b64' }] });
  });
});
