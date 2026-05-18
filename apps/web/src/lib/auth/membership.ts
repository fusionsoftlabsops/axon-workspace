/**
 * Shared helper to gate server actions on project membership.
 *
 * Returns a discriminated union the caller pattern-matches with `!ctx.ok`.
 * Used by tasks.ts, brain.ts, credentials.ts, etc. — keep behavior in sync
 * with the API-token equivalent in `lib/api-auth.ts::requireApiToken`.
 */
import type { MemberRole } from '@prisma/client';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';

export type ProjectMemberCtx =
  | { ok: true; projectId: string; userId: string; role: MemberRole }
  | { ok: false; error: string };

export async function assertProjectMember(projectSlug: string): Promise<ProjectMemberCtx> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'No autenticado' };

  const project = await prisma.project.findUnique({
    where: { slug: projectSlug },
    select: {
      id: true,
      members: { where: { userId }, select: { role: true } },
    },
  });
  if (!project || project.members.length === 0) {
    return { ok: false, error: 'Proyecto no encontrado' };
  }
  return { ok: true, projectId: project.id, userId, role: project.members[0]!.role };
}
