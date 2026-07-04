import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';

/**
 * Corridas de agentes del proyecto (solo lectura) — la señal dura de salud del
 * equipo para el SUPERVISOR de consola: RUNNING = trabajando, FAILED /
 * BUDGET_EXCEEDED = intervenir. (La ruta /agent-runs POST/PATCH es la bitácora
 * que escriben los propios agentes; esta es la vista de monitoreo.)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const authd = await requireApiToken(req, ['tasks:read']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }
  const project = await prisma.project.findUnique({
    where: { slug },
    select: { id: true, members: { where: { userId: authd.userId }, select: { role: true } } },
  });
  if (!project || project.members.length === 0) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }

  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('limit') ?? '30', 10) || 30, 1), 100);
  const status = req.nextUrl.searchParams.get('status'); // opcional: RUNNING | FAILED | ...
  const runs = await prisma.agentRun.findMany({
    where: {
      agent: { projectId: project.id },
      ...(status ? { status: status as never } : {}),
    },
    include: {
      agent: { select: { role: true } },
      story: { select: { taskNumber: true, title: true } },
    },
    orderBy: { startedAt: 'desc' },
    take: limit,
  });

  return NextResponse.json({
    runs: runs.map((r) => ({
      id: r.id,
      role: r.agent.role,
      storyNumber: r.story?.taskNumber ?? null,
      storyTitle: r.story?.title ?? null,
      status: r.status,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      costUsd: r.costUsd.toString(),
      error: r.error,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
    })),
  });
}
