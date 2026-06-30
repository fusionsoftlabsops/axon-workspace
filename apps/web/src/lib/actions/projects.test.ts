import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const {
  prismaMock,
  txMock,
  authMock,
  auditMock,
  assertMock,
  revalidateMock,
  redirectMock,
  ensureMcpMock,
  ensureFolderMock,
  isStorageMock,
  sendMailMock,
  envMock,
  hashMock,
} = vi.hoisted(() => {
  const txMock = {
    project: { create: vi.fn(), delete: vi.fn() },
    workflow: { create: vi.fn() },
    task: { deleteMany: vi.fn() },
  };
  return {
    txMock,
    prismaMock: {
      project: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
      projectMember: { create: vi.fn(), updateMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
      invitation: { deleteMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
      user: { findUnique: vi.fn() },
      credentialAccess: { deleteMany: vi.fn() },
      task: { deleteMany: vi.fn() },
      $transaction: vi.fn((arg: unknown) =>
        Array.isArray(arg) ? Promise.all(arg) : (arg as (t: typeof txMock) => unknown)(txMock),
      ),
    },
    authMock: vi.fn(),
    auditMock: vi.fn(),
    assertMock: vi.fn(),
    revalidateMock: vi.fn(),
    redirectMock: vi.fn(),
    ensureMcpMock: vi.fn(),
    ensureFolderMock: vi.fn(),
    isStorageMock: vi.fn(),
    sendMailMock: vi.fn(),
    envMock: vi.fn(() => ({ AUTH_URL: undefined as string | undefined })),
    hashMock: vi.fn(() => 'token-hash'),
  };
});

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));
vi.mock('@/lib/auth/membership', () => ({ assertProjectMember: assertMock }));
vi.mock('@/lib/mcp-service', () => ({ ensureMcpServiceMembership: ensureMcpMock }));
vi.mock('@/lib/storage', () => ({ ensureProjectFolder: ensureFolderMock, isStorageConfigured: isStorageMock }));
vi.mock('@/lib/invite-token', () => ({ hashInviteToken: hashMock }));
vi.mock('@/lib/env', () => ({ env: envMock }));
vi.mock('@/lib/mailer', () => ({ sendMail: sendMailMock }));

import {
  createProjectAction,
  inviteMemberAction,
  resendInvitationAction,
  transferOwnershipAction,
  setMemberSeniorityAction,
  updateMemberRoleAction,
  removeMemberAction,
  createProjectThenRedirect,
  setProjectStatusAction,
  deleteProjectAction,
} from './projects';

const okCtx = { ok: true, userId: 'u1', projectId: 'p1', role: 'OWNER' as const };
const projectAs = (role: string, extra: Record<string, unknown> = {}) => ({
  id: 'p1',
  ownerId: 'owner',
  name: 'Proj',
  members: [{ role }],
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation((arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (t: typeof txMock) => unknown)(txMock),
  );
  authMock.mockResolvedValue({ user: { id: 'u1' } });
  assertMock.mockResolvedValue(okCtx);
  isStorageMock.mockReturnValue(false);
  envMock.mockReturnValue({ AUTH_URL: undefined });
  txMock.project.create.mockResolvedValue({ id: 'pj1' });
});

describe('createProjectAction', () => {
  const input = { slug: 'my-proj', name: 'My' };

  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await createProjectAction(input)).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects invalid input with field errors', async () => {
    const res = await createProjectAction({ slug: 'A', name: '' } as never);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('Datos inválidos');
  });

  it('creates the project + default workflow', async () => {
    const res = await createProjectAction(input);
    expect(txMock.project.create).toHaveBeenCalled();
    expect(txMock.workflow.create).toHaveBeenCalled();
    expect(ensureMcpMock).toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'project.create' }));
    expect(res).toEqual({ ok: true, data: { slug: 'my-proj' } });
  });

  it('reports a duplicate slug (P2002)', async () => {
    txMock.project.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5' }),
    );
    expect(await createProjectAction(input)).toEqual({ ok: false, error: 'Ya existe un proyecto con ese slug' });
  });

  it('rethrows unexpected errors', async () => {
    txMock.project.create.mockRejectedValue(new Error('db down'));
    await expect(createProjectAction(input)).rejects.toThrow('db down');
  });

  it('materializes the storage folder when configured, swallowing failures', async () => {
    isStorageMock.mockReturnValue(true);
    ensureFolderMock.mockRejectedValue(new Error('s3 down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await createProjectAction(input);
    expect(ensureFolderMock).toHaveBeenCalledWith('my-proj');
    expect(res.ok).toBe(true);
    errSpy.mockRestore();
  });
});

describe('inviteMemberAction', () => {
  const input = { email: 'New@X.com', role: 'MEMBER' as const };

  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await inviteMemberAction('slug', input)).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects invalid input', async () => {
    expect(await inviteMemberAction('slug', { email: 'bad', role: 'MEMBER' } as never)).toEqual({
      ok: false,
      error: 'Datos inválidos',
    });
  });

  it('rejects a missing project', async () => {
    prismaMock.project.findUnique.mockResolvedValue(null);
    expect(await inviteMemberAction('slug', input)).toEqual({ ok: false, error: 'Proyecto no encontrado' });
  });

  it('rejects a non OWNER/ADMIN inviter', async () => {
    prismaMock.project.findUnique.mockResolvedValue(projectAs('MEMBER'));
    const res = await inviteMemberAction('slug', input);
    expect(res.ok).toBe(false);
  });

  it('rejects inviting another OWNER', async () => {
    prismaMock.project.findUnique.mockResolvedValue(projectAs('OWNER'));
    const res = await inviteMemberAction('slug', { ...input, role: 'OWNER' });
    expect(res.ok).toBe(false);
  });

  it('creates a pending registration invite for a new email', async () => {
    prismaMock.project.findUnique.mockResolvedValue(projectAs('OWNER'));
    prismaMock.user.findUnique.mockResolvedValue(null);
    envMock.mockReturnValue({ AUTH_URL: 'https://axon.test' });
    sendMailMock.mockResolvedValue(true);
    const res = await inviteMemberAction('slug', input);
    expect(prismaMock.invitation.create).toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toMatchObject({ pending: true, emailSent: true });
  });

  it('adds an existing user directly', async () => {
    prismaMock.project.findUnique.mockResolvedValue(projectAs('OWNER'));
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u2' });
    const res = await inviteMemberAction('slug', input);
    expect(prismaMock.projectMember.create).toHaveBeenCalled();
    if (res.ok) expect(res.data).toEqual({ pending: false, email: 'new@x.com', emailSent: false });
  });

  it('reports when the user is already a member (P2002)', async () => {
    prismaMock.project.findUnique.mockResolvedValue(projectAs('OWNER'));
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u2' });
    prismaMock.projectMember.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5' }),
    );
    expect(await inviteMemberAction('slug', input)).toEqual({ ok: false, error: 'Ese usuario ya es miembro del proyecto' });
  });

  it('emails an existing user when added and carries seniority', async () => {
    prismaMock.project.findUnique.mockResolvedValue(projectAs('OWNER'));
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u2' });
    prismaMock.projectMember.create.mockResolvedValue({});
    envMock.mockReturnValue({ AUTH_URL: 'https://axon.test' });
    sendMailMock.mockResolvedValue(true);
    const res = await inviteMemberAction('slug', { email: 'New@X.com', role: 'MEMBER', seniority: 'SENIOR' });
    expect(prismaMock.projectMember.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ seniority: 'SENIOR' }) }),
    );
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'new@x.com' }));
    if (res.ok) expect(res.data).toEqual({ pending: false, email: 'new@x.com', emailSent: true });
  });

  it('stores seniority on a registration invite for a new email', async () => {
    prismaMock.project.findUnique.mockResolvedValue(projectAs('OWNER'));
    prismaMock.user.findUnique.mockResolvedValue(null);
    await inviteMemberAction('slug', { email: 'fresh@x.com', role: 'MEMBER', seniority: 'JUNIOR' });
    expect(prismaMock.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ seniority: 'JUNIOR', projectRole: 'MEMBER' }) }),
    );
  });
});

describe('resendInvitationAction', () => {
  it('rejects a non OWNER/ADMIN', async () => {
    prismaMock.project.findUnique.mockResolvedValue({ id: 'p1', name: 'Proj', members: [{ role: 'MEMBER' }] });
    expect(await resendInvitationAction('slug', 'inv1')).toEqual({
      ok: false,
      error: 'Sin permisos para reenviar invitaciones',
    });
  });

  it('rejects a missing/accepted invitation', async () => {
    prismaMock.project.findUnique.mockResolvedValue({ id: 'p1', name: 'Proj', members: [{ role: 'OWNER' }] });
    prismaMock.invitation.findFirst.mockResolvedValue(null);
    expect(await resendInvitationAction('slug', 'inv1')).toEqual({
      ok: false,
      error: 'Invitación no encontrada o ya aceptada',
    });
  });

  it('rotates the token and re-emails a pending invite', async () => {
    prismaMock.project.findUnique.mockResolvedValue({ id: 'p1', name: 'Proj', members: [{ role: 'OWNER' }] });
    prismaMock.invitation.findFirst.mockResolvedValue({ id: 'inv1', email: 'pending@x.com' });
    envMock.mockReturnValue({ AUTH_URL: 'https://axon.test' });
    sendMailMock.mockResolvedValue(true);
    const res = await resendInvitationAction('slug', 'inv1');
    expect(prismaMock.invitation.update).toHaveBeenCalled();
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'pending@x.com' }));
    expect(res.ok && res.data?.emailSent).toBe(true);
  });
});

describe('transferOwnershipAction', () => {
  const ownerProject = (extra: Record<string, unknown> = {}) => ({
    id: 'p1',
    ownerId: 'u1',
    members: [
      { userId: 'u1', role: 'OWNER' },
      { userId: 'u2', role: 'ADMIN' },
    ],
    ...extra,
  });

  it('rejects when caller is not the owner', async () => {
    prismaMock.project.findUnique.mockResolvedValue(ownerProject({ ownerId: 'someone-else' }));
    expect(await transferOwnershipAction('slug', 'u2')).toEqual({
      ok: false,
      error: 'Solo el OWNER puede transferir la propiedad',
    });
  });

  it('rejects when the target is not a member', async () => {
    prismaMock.project.findUnique.mockResolvedValue(ownerProject());
    expect(await transferOwnershipAction('slug', 'ghost')).toEqual({
      ok: false,
      error: 'El nuevo OWNER debe ser miembro del proyecto',
    });
  });

  it('swaps roles and updates ownerId', async () => {
    prismaMock.project.findUnique.mockResolvedValue(ownerProject());
    const res = await transferOwnershipAction('slug', 'u2');
    expect(res.ok).toBe(true);
    expect(prismaMock.project.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { ownerId: 'u2' } }),
    );
    expect(prismaMock.projectMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId_userId: { projectId: 'p1', userId: 'u2' } },
        data: { role: 'OWNER' },
      }),
    );
    expect(prismaMock.projectMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId_userId: { projectId: 'p1', userId: 'u1' } },
        data: { role: 'ADMIN' },
      }),
    );
  });
});

describe('setMemberSeniorityAction', () => {
  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await setMemberSeniorityAction('slug', 'u2', 'SENIOR')).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects a missing project', async () => {
    prismaMock.project.findUnique.mockResolvedValue(null);
    expect(await setMemberSeniorityAction('slug', 'u2', 'SENIOR')).toEqual({ ok: false, error: 'Proyecto no encontrado' });
  });

  it('rejects a non OWNER/ADMIN', async () => {
    prismaMock.project.findUnique.mockResolvedValue(projectAs('MEMBER'));
    expect(await setMemberSeniorityAction('slug', 'u2', 'SENIOR')).toEqual({ ok: false, error: 'Sin permisos' });
  });

  it('sets a valid seniority', async () => {
    prismaMock.project.findUnique.mockResolvedValue(projectAs('OWNER'));
    const res = await setMemberSeniorityAction('slug', 'u2', 'SENIOR');
    expect(prismaMock.projectMember.updateMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', userId: 'u2' },
      data: { seniority: 'SENIOR' },
    });
    expect(res).toEqual({ ok: true });
  });

  it('nulls out an invalid seniority value', async () => {
    prismaMock.project.findUnique.mockResolvedValue(projectAs('OWNER'));
    await setMemberSeniorityAction('slug', 'u2', 'BOGUS');
    expect(prismaMock.projectMember.updateMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', userId: 'u2' },
      data: { seniority: null },
    });
  });
});

describe('updateMemberRoleAction', () => {
  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await updateMemberRoleAction('slug', 'u2', 'ADMIN')).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects assigning OWNER directly', async () => {
    const res = await updateMemberRoleAction('slug', 'u2', 'OWNER');
    expect(res.ok).toBe(false);
  });

  it('rejects a missing project', async () => {
    prismaMock.project.findUnique.mockResolvedValue(null);
    expect(await updateMemberRoleAction('slug', 'u2', 'ADMIN')).toEqual({ ok: false, error: 'Proyecto no encontrado' });
  });

  it('rejects a non OWNER/ADMIN', async () => {
    prismaMock.project.findUnique.mockResolvedValue(projectAs('MEMBER'));
    expect(await updateMemberRoleAction('slug', 'u2', 'ADMIN')).toEqual({ ok: false, error: 'Sin permisos' });
  });

  it('rejects changing the OWNER role', async () => {
    prismaMock.project.findUnique.mockResolvedValue(projectAs('OWNER', { ownerId: 'u2' }));
    expect(await updateMemberRoleAction('slug', 'u2', 'ADMIN')).toEqual({ ok: false, error: 'No se puede cambiar el rol del OWNER' });
  });

  it('updates the member role', async () => {
    prismaMock.project.findUnique.mockResolvedValue(projectAs('OWNER'));
    const res = await updateMemberRoleAction('slug', 'u2', 'ADMIN');
    expect(prismaMock.projectMember.update).toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'member.role_change' }));
    expect(res).toEqual({ ok: true });
  });
});

describe('removeMemberAction', () => {
  it('rejects unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect(await removeMemberAction('slug', 'u2')).toEqual({ ok: false, error: 'No autenticado' });
  });

  it('rejects a missing project', async () => {
    prismaMock.project.findUnique.mockResolvedValue(null);
    expect(await removeMemberAction('slug', 'u2')).toEqual({ ok: false, error: 'Proyecto no encontrado' });
  });

  it('rejects a non OWNER/ADMIN', async () => {
    prismaMock.project.findUnique.mockResolvedValue(projectAs('MEMBER'));
    expect(await removeMemberAction('slug', 'u2')).toEqual({ ok: false, error: 'Sin permisos' });
  });

  it('rejects removing the OWNER', async () => {
    prismaMock.project.findUnique.mockResolvedValue(projectAs('OWNER', { ownerId: 'u2' }));
    expect(await removeMemberAction('slug', 'u2')).toEqual({ ok: false, error: 'No se puede expulsar al OWNER' });
  });

  it('removes the member and their credential access', async () => {
    prismaMock.project.findUnique.mockResolvedValue(projectAs('OWNER'));
    const res = await removeMemberAction('slug', 'u2');
    expect(prismaMock.projectMember.delete).toHaveBeenCalled();
    expect(prismaMock.credentialAccess.deleteMany).toHaveBeenCalled();
    expect(res).toEqual({ ok: true });
  });
});

describe('createProjectThenRedirect', () => {
  it('redirects on success', async () => {
    await createProjectThenRedirect({ slug: 'my-proj', name: 'My' });
    expect(redirectMock).toHaveBeenCalledWith('/projects/my-proj');
  });

  it('returns the result without redirecting on failure', async () => {
    authMock.mockResolvedValue(null);
    const res = await createProjectThenRedirect({ slug: 'my-proj', name: 'My' });
    expect(redirectMock).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });
});

describe('setProjectStatusAction', () => {
  it('propagates the membership error', async () => {
    assertMock.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await setProjectStatusAction('slug', 'ACTIVE')).toEqual({ ok: false, error: 'nope' });
  });

  it('rejects a non OWNER/ADMIN', async () => {
    assertMock.mockResolvedValue({ ...okCtx, role: 'MEMBER' });
    const res = await setProjectStatusAction('slug', 'ACTIVE');
    expect(res.ok).toBe(false);
  });

  it('rejects an invalid status', async () => {
    const res = await setProjectStatusAction('slug', 'BOGUS' as never);
    expect(res).toEqual({ ok: false, error: 'Estado inválido' });
  });

  it('updates the status', async () => {
    const res = await setProjectStatusAction('slug', 'PAUSED');
    expect(prismaMock.project.update).toHaveBeenCalled();
    expect(res).toEqual({ ok: true, data: { status: 'PAUSED' } });
  });
});

describe('deleteProjectAction', () => {
  it('propagates the membership error', async () => {
    assertMock.mockResolvedValue({ ok: false, error: 'nope' });
    expect(await deleteProjectAction('slug')).toEqual({ ok: false, error: 'nope' });
  });

  it('rejects a non OWNER/ADMIN', async () => {
    assertMock.mockResolvedValue({ ...okCtx, role: 'MEMBER' });
    const res = await deleteProjectAction('slug');
    expect(res.ok).toBe(false);
  });

  it('deletes the project (tasks first)', async () => {
    prismaMock.project.findUnique.mockResolvedValue({ slug: 'slug', name: 'Proj' });
    const res = await deleteProjectAction('slug');
    expect(prismaMock.$transaction).toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'project.delete' }));
    expect(res).toEqual({ ok: true });
  });
});
