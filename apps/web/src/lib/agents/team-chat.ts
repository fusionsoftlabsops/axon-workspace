/**
 * Chat del equipo (Fase 2): el "standup" permanente del proyecto donde cada
 * agente narra su turno y los humanos leen e intervienen en el mismo hilo.
 *
 * Una sola puerta de entrada (postTeamMessage) usada por el server action
 * (humanos) y la Admin API (agentes): persiste la fila y la emite en vivo por
 * el canal Redis del proyecto (mismo bus realtime del chat del plan).
 */
import type { AgentRole, TeamMessageKind } from '@prisma/client';
import { ROLE_META } from '@admin/shared';
import { prisma } from '@/lib/db';
import { publish } from '@/lib/realtime';

/** Canal realtime del equipo de un proyecto. */
export function teamChannel(projectId: string): string {
  return `team:${projectId}`;
}

/** Nombres propios por defecto del equipo (de la fuente única; editables en la
 *  pestaña Agentes). */
export const DEFAULT_AGENT_NAMES: Record<AgentRole, string> = Object.fromEntries(
  (Object.keys(ROLE_META) as AgentRole[]).map((r) => [r, ROLE_META[r].persona]),
) as Record<AgentRole, string>;

export function agentDisplayName(role: AgentRole, displayName?: string | null): string {
  return `${displayName?.trim() || DEFAULT_AGENT_NAMES[role]} · ${role}`;
}

export interface TeamMessageView {
  id: string;
  authorId: string;
  agentRole: AgentRole | null;
  authorName: string;
  kind: TeamMessageKind;
  body: string;
  storyNumber: number | null;
  createdAt: string;
}

export interface PostTeamMessageInput {
  projectId: string;
  authorId: string;
  agentRole?: AgentRole | null;
  authorName: string;
  kind?: TeamMessageKind;
  body: string;
  storyId?: string | null;
  storyNumber?: number | null;
}

/** Persiste el mensaje y lo emite en vivo. Devuelve la vista lista para UI. */
export async function postTeamMessage(input: PostTeamMessageInput): Promise<TeamMessageView> {
  const row = await prisma.teamChatMessage.create({
    data: {
      projectId: input.projectId,
      authorId: input.authorId,
      agentRole: input.agentRole ?? null,
      authorName: input.authorName,
      kind: input.kind ?? 'CHAT',
      body: input.body,
      storyId: input.storyId ?? null,
    },
  });
  const view: TeamMessageView = {
    id: row.id,
    authorId: row.authorId,
    agentRole: row.agentRole,
    authorName: row.authorName,
    kind: row.kind,
    body: row.body,
    storyNumber: input.storyNumber ?? null,
    createdAt: row.createdAt.toISOString(),
  };
  // En vivo, best-effort: el mensaje ya está persistido aunque Redis falle.
  void publish(teamChannel(input.projectId), { type: 'team.message', message: view }).catch(() => {});
  return view;
}

/** Últimos mensajes del hilo (ascendente para render directo). */
export async function listTeamMessages(projectId: string, limit = 100): Promise<TeamMessageView[]> {
  const rows = await prisma.teamChatMessage.findMany({
    where: { projectId },
    include: { story: { select: { taskNumber: true } } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 300),
  });
  return rows.reverse().map((r) => ({
    id: r.id,
    authorId: r.authorId,
    agentRole: r.agentRole,
    authorName: r.authorName,
    kind: r.kind,
    body: r.body,
    storyNumber: r.story?.taskNumber ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}
