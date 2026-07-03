import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';

const createBody = z.object({
  storyId: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
});

/**
 * Abre una corrida (AgentRun RUNNING) para el agente que llama. La bitácora es
 * la base de la atribución de costo por rol y del corte de presupuesto — el
 * worker la abre ANTES de invocar al modelo y la cierra al terminar.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const authd = await requireApiToken(req, ['tasks:write']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }

  const project = await prisma.project.findUnique({ where: { slug }, select: { id: true } });
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 });

  const agent = await prisma.agent.findFirst({
    where: { projectId: project.id, userId: authd.userId },
    select: { id: true, enabled: true, tokenBudget: true },
  });
  if (!agent) {
    return NextResponse.json({ error: 'caller is not an agent of this project' }, { status: 404 });
  }
  if (!agent.enabled) {
    return NextResponse.json({ error: 'agent is disabled for this project' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = createBody.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  // storyId es opcional y debe pertenecer al proyecto si viene.
  let storyId: string | null = null;
  if (parsed.data.storyId) {
    const story = await prisma.task.findFirst({
      where: { id: parsed.data.storyId, projectId: project.id },
      select: { id: true },
    });
    if (!story) return NextResponse.json({ error: 'story not found in this project' }, { status: 400 });
    storyId = story.id;
  }

  const run = await prisma.agentRun.create({
    data: {
      agentId: agent.id,
      storyId,
      payload: (parsed.data.payload ?? undefined) as never,
    },
    select: { id: true, startedAt: true },
  });

  return NextResponse.json(
    { id: run.id, startedAt: run.startedAt.toISOString(), tokenBudget: agent.tokenBudget },
    { status: 201 },
  );
}
