'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Prisma, type MemberRole, type ProjectStatus } from '@prisma/client';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { assertProjectMember } from '@/lib/auth/membership';
import { ensureMcpServiceMembership } from '@/lib/mcp-service';
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
    projectId: createdProjectId,
    payload: { slug: data.slug, name: data.name },
  });

  revalidatePath('/projects');
  return { ok: true, data: { slug: data.slug } };
}

/** Invite an existing user (by email) to a project with a specific role. */
export async function inviteMemberAction(
  projectSlug: string,
  input: InviteMemberInput,
): Promise<ActionResult> {
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

  const invitee = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase().trim() },
  });
  if (!invitee) return { ok: false, error: 'No existe un usuario con ese email' };

  if (parsed.data.role === 'OWNER') {
    return { ok: false, error: 'Solo puede haber un OWNER. Usa "Transferir propiedad" en su lugar.' };
  }

  try {
    await prisma.projectMember.create({
      data: {
        projectId: project.id,
        userId: invitee.id,
        role: parsed.data.role,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, error: 'Ese usuario ya es miembro del proyecto' };
    }
    throw err;
  }

  await audit({
    actorId: session.user.id,
    action: 'member.invite',
    resourceType: 'project',
    resourceId: project.id,
    projectId: project.id,
    payload: { invitedUserId: invitee.id, role: parsed.data.role },
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
