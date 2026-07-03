'use server';

import { prisma } from '@/lib/db';
import { assertProjectMember } from '@/lib/auth/membership';
import { listTeamMessages, postTeamMessage, type TeamMessageView } from '@/lib/agents/team-chat';
import type { ActionResult } from './projects';

/** Hilo del equipo para la UI (últimos N, ascendente). */
export async function listTeamChatAction(
  slug: string,
  limit = 100,
): Promise<ActionResult<TeamMessageView[]>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  return { ok: true, data: await listTeamMessages(ctx.projectId, limit) };
}

/** Mensaje de un HUMANO al hilo del equipo (los agentes postean por la API). */
export async function postTeamChatAction(
  slug: string,
  body: string,
): Promise<ActionResult<TeamMessageView>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos para escribir' };
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: 'Mensaje vacío' };
  if (trimmed.length > 20_000) return { ok: false, error: 'Mensaje demasiado largo' };

  const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
  const message = await postTeamMessage({
    projectId: ctx.projectId,
    authorId: ctx.userId,
    agentRole: null,
    authorName: user?.name ?? 'Miembro',
    kind: 'CHAT',
    body: trimmed,
  });
  return { ok: true, data: message };
}
