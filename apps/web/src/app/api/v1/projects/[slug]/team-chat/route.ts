import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import {
  agentDisplayName,
  listTeamMessages,
  postTeamMessage,
} from '@/lib/agents/team-chat';

const postBody = z.object({
  body: z.string().min(1).max(20_000),
  kind: z.enum(['CHAT', 'STATUS', 'HANDOFF']).default('CHAT'),
  storyNumber: z.number().int().positive().optional(),
});

async function resolveProject(slug: string, userId: string) {
  return prisma.project.findUnique({
    where: { slug },
    select: { id: true, members: { where: { userId }, select: { role: true } } },
  });
}

/** Hilo del equipo (últimos mensajes). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const authd = await requireApiToken(req, ['projects:read']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }
  const project = await resolveProject(slug, authd.userId);
  if (!project || project.members.length === 0) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '100', 10);
  return NextResponse.json({ messages: await listTeamMessages(project.id, limit) });
}

/**
 * Publica un mensaje en el hilo del equipo. Los AGENTES son el llamador
 * principal (su identidad y nombre se resuelven por token); los humanos usan
 * el server action de la UI.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const authd = await requireApiToken(req, ['comments:write']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }
  const project = await resolveProject(slug, authd.userId);
  if (!project || project.members.length === 0) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }
  if (project.members[0]!.role === 'VIEWER') {
    return NextResponse.json({ error: 'viewer cannot post' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = postBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  // Identidad: agente (nombre propio + rol) o humano (nombre de usuario).
  const agent = await prisma.agent.findFirst({
    where: { projectId: project.id, userId: authd.userId },
    select: { role: true, displayName: true, enabled: true },
  });
  let authorName: string;
  if (agent) {
    if (!agent.enabled) {
      return NextResponse.json({ error: 'agent is disabled for this project' }, { status: 403 });
    }
    authorName = agentDisplayName(agent.role, agent.displayName);
  } else {
    const user = await prisma.user.findUnique({ where: { id: authd.userId }, select: { name: true } });
    authorName = user?.name ?? 'Miembro';
  }

  // HU relacionada (opcional): resolver número → id dentro del proyecto.
  let storyId: string | null = null;
  if (parsed.data.storyNumber) {
    const story = await prisma.task.findUnique({
      where: { projectId_taskNumber: { projectId: project.id, taskNumber: parsed.data.storyNumber } },
      select: { id: true },
    });
    storyId = story?.id ?? null;
  }

  const message = await postTeamMessage({
    projectId: project.id,
    authorId: authd.userId,
    agentRole: agent?.role ?? null,
    authorName,
    kind: parsed.data.kind,
    body: parsed.data.body,
    storyId,
    storyNumber: parsed.data.storyNumber ?? null,
  });
  return NextResponse.json({ message }, { status: 201 });
}
