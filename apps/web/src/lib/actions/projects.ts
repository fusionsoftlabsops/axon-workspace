'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Prisma, type MemberRole, type ProjectStatus, type Seniority } from '@prisma/client';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { assertProjectMember } from '@/lib/auth/membership';
import { ensureMcpServiceMembership } from '@/lib/mcp-service';
import { ensureProjectFolder, isStorageConfigured } from '@/lib/storage';
import { randomBytes } from 'node:crypto';
import { hashInviteToken } from '@/lib/invite-token';
import { env } from '@/lib/env';
import { sendMail } from '@/lib/mailer';
import {
  createProjectSchema,
  inviteMemberSchema,
  type CreateProjectInput,
  type InviteMemberInput,
} from '@admin/shared/schemas';
import { DEFAULT_WORKFLOW_STATES } from '@admin/shared/types';

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Create a new project owned by the current user, with the default workflow. */
export async function createProjectAction(
  input: CreateProjectInput,
): Promise<ActionResult<{ slug: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'No autenticado' };

  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Datos inválidos',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join('.'), i.message]),
      ),
    };
  }

  const data = parsed.data;
  let createdProjectId = '';
  try {
    await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          slug: data.slug,
          name: data.name,
          description: data.description,
          agentRuntime: data.runtime,
          ownerId: session.user.id,
          members: { create: { userId: session.user.id, role: 'OWNER' } },
          taskCounter: { create: { next: 1 } },
        },
      });
      createdProjectId = project.id;

      await tx.workflow.create({
        data: {
          projectId: project.id,
          name: 'Default',
          isDefault: true,
          states: {
            create: DEFAULT_WORKFLOW_STATES.map((s, i) => ({
              name: s.name,
              color: s.color,
              category: s.category,
              order: i,
            })),
          },
        },
      });

      // Silently add the MCP service user so Claude Code sees this project.
      // No-op if no MCP service user is configured yet.
      await ensureMcpServiceMembership(tx, project.id);
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, error: 'Ya existe un proyecto con ese slug' };
    }
    throw err;
  }

  await audit({
    actorId: session.user.id,
    action: 'project.create',
    resourceType: 'project',
    resourceId: createdProjectId,
    payload: { slug: data.slug, name: data.name },
    projectId: createdProjectId,
  });

  // Materialize the project's main folder in object storage. Best-effort: the
  // project is already created, and the folder is also created lazily on the
  // first upload, so a storage hiccup must not fail project creation.
  if (isStorageConfigured()) {
    try {
      await ensureProjectFolder(data.slug);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[projects] ensureProjectFolder failed:', err);
    }
  }

  // Auto-provisiona el equipo agéntico por defecto (estilo axon: 9 roles
  // habilitados). Best-effort — el proyecto ya existe y el equipo se puede
  // aprovisionar luego desde la UI/consola, así que un fallo no debe romper la
  // creación. El worker multi-tenant toma el equipo en su próximo refresco.
  try {
    const { provisionDefaultTeam } = await import('./agents');
    await provisionDefaultTeam(createdProjectId, data.slug);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[projects] provisionDefaultTeam failed:', err);
  }

  revalidatePath('/projects');
  return { ok: true, data: { slug: data.slug } };
}

/** Invite an existing user (by email) to a project with a specific role. */
export async function inviteMemberAction(
  projectSlug: string,
  input: InviteMemberInput,
): Promise<ActionResult<{ pending: boolean; token?: string; email?: string; emailSent?: boolean }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'No autenticado' };

  const parsed = inviteMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' };

  const project = await prisma.project.findUnique({
    where: { slug: projectSlug },
    include: { members: { where: { userId: session.user.id } } },
  });
  if (!project) return { ok: false, error: 'Proyecto no encontrado' };

  const myRole = project.members[0]?.role;
  if (myRole !== 'OWNER' && myRole !== 'ADMIN') {
    return { ok: false, error: 'Sin permisos para invitar miembros' };
  }

  if (parsed.data.role === 'OWNER') {
    return { ok: false, error: 'Solo puede haber un OWNER. Usa "Transferir propiedad" en su lugar.' };
  }

  const email = parsed.data.email.toLowerCase().trim();
  const seniority = parsed.data.seniority ?? null;
  const invitee = await prisma.user.findUnique({ where: { email } });

  // Not registered yet → create a project-scoped registration invite. On signup
  // with the link, the new account auto-joins this project with the chosen role.
  if (!invitee) {
    await prisma.invitation.deleteMany({ where: { email, acceptedAt: null, projectId: project.id } });
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    await prisma.invitation.create({
      data: {
        email,
        tokenHash: hashInviteToken(token),
        invitedById: session.user.id,
        expiresAt,
        projectId: project.id,
        projectRole: parsed.data.role,
        seniority,
      },
    });

    const emailSent = await sendProjectInviteEmail(email, project.name, token);

    await audit({
      actorId: session.user.id,
      action: 'member.invite',
      resourceType: 'project',
      resourceId: project.id,
      projectId: project.id,
      payload: { email, role: parsed.data.role, seniority, emailSent, pending: true },
    });
    revalidatePath(`/projects/${projectSlug}/settings`);
    return { ok: true, data: { pending: true, token, email, emailSent } };
  }

  try {
    await prisma.projectMember.create({
      data: {
        projectId: project.id,
        userId: invitee.id,
        role: parsed.data.role,
        seniority,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, error: 'Ese usuario ya es miembro del proyecto' };
    }
    throw err;
  }

  // Existing accounts are added directly (no signup needed) — but they still
  // deserve a heads-up. Previously this path sent NO email, so already-registered
  // collaborators were added silently with no notification.
  const emailSent = await sendProjectAddedEmail(email, project.name, projectSlug);

  await audit({
    actorId: session.user.id,
    action: 'member.invite',
    resourceType: 'project',
    resourceId: project.id,
    projectId: project.id,
    payload: { invitedUserId: invitee.id, role: parsed.data.role, seniority, emailSent },
  });

  revalidatePath(`/projects/${projectSlug}/settings`);
  return { ok: true, data: { pending: false, email, emailSent } };
}

/** Email a registration invite link for a project (new, unregistered email). */
async function sendProjectInviteEmail(
  email: string,
  projectName: string,
  token: string,
): Promise<boolean> {
  const base = env().AUTH_URL?.replace(/\/+$/, '');
  if (!base) return false;
  const link = `${base}/signup?token=${token}`;
  return sendMail({
    to: email,
    subject: `Invitación a ${projectName} en Axon`,
    html:
      `<p>Te invitaron a colaborar en <b>${projectName}</b> en Axon.</p>` +
      `<p>Creá tu cuenta con este enlace (válido 7 días, un solo uso): <a href="${link}">${link}</a></p>`,
    text: `Te invitaron a colaborar en ${projectName} en Axon. Creá tu cuenta (válido 7 días): ${link}`,
  });
}

/** Notify an already-registered user that they were added to a project. */
async function sendProjectAddedEmail(
  email: string,
  projectName: string,
  projectSlug: string,
): Promise<boolean> {
  const base = env().AUTH_URL?.replace(/\/+$/, '');
  if (!base) return false;
  const link = `${base}/projects/${projectSlug}`;
  return sendMail({
    to: email,
    subject: `Te agregaron a ${projectName} en Axon`,
    html:
      `<p>Te agregaron como colaborador en <b>${projectName}</b> en Axon.</p>` +
      `<p>Entrá al proyecto: <a href="${link}">${link}</a></p>`,
    text: `Te agregaron como colaborador en ${projectName} en Axon. Entrá: ${link}`,
  });
}

/**
 * Resend a pending project invitation email. Rotates the token (so the previous
 * link is invalidated) and renews the 7-day expiry. OWNER/ADMIN only.
 */
export async function resendInvitationAction(
  projectSlug: string,
  invitationId: string,
): Promise<ActionResult<{ emailSent: boolean; token: string; email: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'No autenticado' };

  const project = await prisma.project.findUnique({
    where: { slug: projectSlug },
    select: { id: true, name: true, members: { where: { userId: session.user.id }, select: { role: true } } },
  });
  if (!project) return { ok: false, error: 'Proyecto no encontrado' };
  const myRole = project.members[0]?.role;
  if (myRole !== 'OWNER' && myRole !== 'ADMIN') {
    return { ok: false, error: 'Sin permisos para reenviar invitaciones' };
  }

  const invite = await prisma.invitation.findFirst({
    where: { id: invitationId, projectId: project.id, acceptedAt: null },
    select: { id: true, email: true },
  });
  if (!invite) return { ok: false, error: 'Invitación no encontrada o ya aceptada' };

  const token = randomBytes(24).toString('base64url');
  await prisma.invitation.update({
    where: { id: invite.id },
    data: { tokenHash: hashInviteToken(token), expiresAt: new Date(Date.now() + 7 * 86_400_000) },
  });

  const emailSent = await sendProjectInviteEmail(invite.email, project.name, token);

  await audit({
    actorId: session.user.id,
    action: 'member.invite_resend',
    resourceType: 'project',
    resourceId: project.id,
    projectId: project.id,
    payload: { email: invite.email, emailSent },
  });

  revalidatePath(`/projects/${projectSlug}/settings`);
  return { ok: true, data: { emailSent, token, email: invite.email } };
}

/**
 * Transfer project ownership to another member. Only the current OWNER may do
 * this. The new owner becomes OWNER and the previous owner is demoted to ADMIN.
 */
export async function transferOwnershipAction(
  projectSlug: string,
  newOwnerUserId: string,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'No autenticado' };

  const project = await prisma.project.findUnique({
    where: { slug: projectSlug },
    select: {
      id: true,
      ownerId: true,
      members: { select: { userId: true, role: true } },
    },
  });
  if (!project) return { ok: false, error: 'Proyecto no encontrado' };
  if (project.ownerId !== session.user.id) {
    return { ok: false, error: 'Solo el OWNER puede transferir la propiedad' };
  }
  if (newOwnerUserId === project.ownerId) {
    return { ok: false, error: 'Ese usuario ya es el OWNER' };
  }
  const target = project.members.find((m) => m.userId === newOwnerUserId);
  if (!target) return { ok: false, error: 'El nuevo OWNER debe ser miembro del proyecto' };

  await prisma.$transaction([
    prisma.project.update({ where: { id: project.id }, data: { ownerId: newOwnerUserId } }),
    prisma.projectMember.update({
      where: { projectId_userId: { projectId: project.id, userId: newOwnerUserId } },
      data: { role: 'OWNER' },
    }),
    prisma.projectMember.update({
      where: { projectId_userId: { projectId: project.id, userId: project.ownerId } },
      data: { role: 'ADMIN' },
    }),
  ]);

  await audit({
    actorId: session.user.id,
    action: 'project.transfer_ownership',
    resourceType: 'project',
    resourceId: project.id,
    projectId: project.id,
    payload: { from: project.ownerId, to: newOwnerUserId },
  });

  revalidatePath('/projects');
  revalidatePath(`/projects/${projectSlug}/settings`);
  return { ok: true };
}

/** Set a member's seniority (for AI time estimation). Only OWNER/ADMIN. */
export async function setMemberSeniorityAction(
  projectSlug: string,
  userId: string,
  seniority: string | null,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'No autenticado' };

  const valid = ['JUNIOR', 'SEMI_SENIOR', 'SENIOR'];
  const value = seniority && valid.includes(seniority) ? (seniority as Seniority) : null;

  const project = await prisma.project.findUnique({
    where: { slug: projectSlug },
    select: { id: true, members: { where: { userId: session.user.id }, select: { role: true } } },
  });
  if (!project) return { ok: false, error: 'Proyecto no encontrado' };
  const myRole = project.members[0]?.role;
  if (myRole !== 'OWNER' && myRole !== 'ADMIN') return { ok: false, error: 'Sin permisos' };

  await prisma.projectMember.updateMany({
    where: { projectId: project.id, userId },
    data: { seniority: value },
  });
  revalidatePath(`/projects/${projectSlug}/settings`);
  return { ok: true };
}

/** Change a member's role. Only OWNER/ADMIN. Cannot demote the OWNER. */
export async function updateMemberRoleAction(
  projectSlug: string,
  userId: string,
  role: MemberRole,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'No autenticado' };
  if (role === 'OWNER') return { ok: false, error: 'No se puede asignar OWNER directamente' };

  const project = await prisma.project.findUnique({
    where: { slug: projectSlug },
    select: { id: true, ownerId: true, members: { where: { userId: session.user.id } } },
  });
  if (!project) return { ok: false, error: 'Proyecto no encontrado' };

  const myRole = project.members[0]?.role;
  if (myRole !== 'OWNER' && myRole !== 'ADMIN') {
    return { ok: false, error: 'Sin permisos' };
  }
  if (userId === project.ownerId) {
    return { ok: false, error: 'No se puede cambiar el rol del OWNER' };
  }

  await prisma.projectMember.update({
    where: { projectId_userId: { projectId: project.id, userId } },
    data: { role },
  });

  await audit({
    actorId: session.user.id,
    action: 'member.role_change',
    resourceType: 'project',
    resourceId: project.id,
    projectId: project.id,
    payload: { userId, newRole: role },
  });

  revalidatePath(`/projects/${projectSlug}/settings`);
  return { ok: true };
}

/** Remove a member from a project. */
export async function removeMemberAction(
  projectSlug: string,
  userId: string,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'No autenticado' };

  const project = await prisma.project.findUnique({
    where: { slug: projectSlug },
    select: { id: true, ownerId: true, members: { where: { userId: session.user.id } } },
  });
  if (!project) return { ok: false, error: 'Proyecto no encontrado' };

  const myRole = project.members[0]?.role;
  if (myRole !== 'OWNER' && myRole !== 'ADMIN') {
    return { ok: false, error: 'Sin permisos' };
  }
  if (userId === project.ownerId) {
    return { ok: false, error: 'No se puede expulsar al OWNER' };
  }

  await prisma.projectMember.delete({
    where: { projectId_userId: { projectId: project.id, userId } },
  });

  // CredentialAccess cascades on user delete but not on membership removal,
  // so we also drop any wrapped DEKs the user had for this project.
  await prisma.credentialAccess.deleteMany({
    where: {
      userId,
      credential: { projectId: project.id },
    },
  });

  await audit({
    actorId: session.user.id,
    action: 'member.remove',
    resourceType: 'project',
    resourceId: project.id,
    projectId: project.id,
    payload: { removedUserId: userId },
  });

  revalidatePath(`/projects/${projectSlug}/settings`);
  return { ok: true };
}

export async function createProjectThenRedirect(input: CreateProjectInput) {
  const result = await createProjectAction(input);
  if (result.ok && result.data) {
    redirect(`/projects/${result.data.slug}`);
  }
  return result;
}

const PROJECT_STATUSES: ProjectStatus[] = ['ACTIVE', 'PAUSED', 'INACTIVE', 'COMPLETED'];

/** Only OWNER/ADMIN may manage a project's lifecycle (status changes + delete). */
function canManageProject(role: MemberRole): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/**
 * Change a project's lifecycle status (active / paused / inactive / completed).
 * Restricted to OWNER/ADMIN.
 */
export async function setProjectStatusAction(
  projectSlug: string,
  status: ProjectStatus,
): Promise<ActionResult<{ status: ProjectStatus }>> {
  const ctx = await assertProjectMember(projectSlug);
  if (!ctx.ok) return ctx;
  if (!canManageProject(ctx.role)) {
    return { ok: false, error: 'Solo OWNER o ADMIN pueden cambiar el estado del proyecto' };
  }
  if (!PROJECT_STATUSES.includes(status)) {
    return { ok: false, error: 'Estado inválido' };
  }

  await prisma.project.update({
    where: { id: ctx.projectId },
    data: { status },
  });

  await audit({
    actorId: ctx.userId,
    action: 'project.update',
    resourceType: 'project',
    resourceId: ctx.projectId,
    projectId: ctx.projectId,
    payload: { status },
  });

  revalidatePath('/projects');
  revalidatePath(`/projects/${projectSlug}/settings`);
  return { ok: true, data: { status } };
}

/**
 * Permanently delete a project and everything under it. Restricted to
 * OWNER/ADMIN. Tasks are removed first because `Task.stateId` references
 * `WorkflowState` with RESTRICT; the project delete then cascades the rest
 * (members, workflows, credentials, brain memories, story drafts, etc.).
 */
export async function deleteProjectAction(projectSlug: string): Promise<ActionResult> {
  const ctx = await assertProjectMember(projectSlug);
  if (!ctx.ok) return ctx;
  if (!canManageProject(ctx.role)) {
    return { ok: false, error: 'Solo OWNER o ADMIN pueden eliminar el proyecto' };
  }

  const project = await prisma.project.findUnique({
    where: { id: ctx.projectId },
    select: { slug: true, name: true },
  });

  await prisma.$transaction([
    prisma.task.deleteMany({ where: { projectId: ctx.projectId } }),
    prisma.project.delete({ where: { id: ctx.projectId } }),
  ]);

  await audit({
    actorId: ctx.userId,
    action: 'project.delete',
    resourceType: 'project',
    resourceId: ctx.projectId,
    projectId: ctx.projectId,
    payload: { slug: project?.slug, name: project?.name },
  });

  revalidatePath('/projects');
  return { ok: true };
}
