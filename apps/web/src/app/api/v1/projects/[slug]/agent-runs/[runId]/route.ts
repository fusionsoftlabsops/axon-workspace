import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';

const patchBody = z.object({
  status: z.enum(['SUCCEEDED', 'FAILED', 'BUDGET_EXCEEDED', 'CANCELLED']),
  promptTokens: z.number().int().min(0).default(0),
  completionTokens: z.number().int().min(0).default(0),
  costUsd: z.number().min(0).optional(),
  error: z.string().max(4000).optional(),
});

/** Cierra una corrida: estado terminal + tokens/costo. Solo el agente dueño. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; runId: string }> },
) {
  const { slug, runId } = await params;
  const authd = await requireApiToken(req, ['tasks:write']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }

  const project = await prisma.project.findUnique({ where: { slug }, select: { id: true } });
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 });

  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { id: true, status: true, agent: { select: { projectId: true, userId: true } } },
  });
  if (!run || run.agent.projectId !== project.id) {
    return NextResponse.json({ error: 'run not found' }, { status: 404 });
  }
  if (run.agent.userId !== authd.userId) {
    return NextResponse.json({ error: 'run belongs to another agent' }, { status: 403 });
  }
  if (run.status !== 'RUNNING') {
    return NextResponse.json({ error: 'run already finished' }, { status: 409 });
  }

  const json = await req.json().catch(() => null);
  const parsed = patchBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;

  await prisma.agentRun.update({
    where: { id: runId },
    data: {
      status: b.status,
      finishedAt: new Date(),
      promptTokens: b.promptTokens,
      completionTokens: b.completionTokens,
      ...(b.costUsd !== undefined ? { costUsd: b.costUsd } : {}),
      ...(b.error ? { error: b.error } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
