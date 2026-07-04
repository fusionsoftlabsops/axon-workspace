import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import { audit } from '@/lib/audit';
import { generateTaskImplPlan } from '@/lib/ai/impl-plan';

async function resolveTask(slug: string, taskNumber: number, userId: string) {
  const project = await prisma.project.findUnique({
    where: { slug },
    select: { id: true, members: { where: { userId }, select: { role: true } } },
  });
  if (!project || project.members.length === 0) return null;
  const task = await prisma.task.findUnique({
    where: { projectId_taskNumber: { projectId: project.id, taskNumber } },
    select: { id: true, implPlan: true, implPlanAt: true },
  });
  if (!task) return null;
  return { project, task, role: project.members[0]!.role };
}

/** Plan de implementación persistido de la HU (o null). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; taskNumber: string }> },
) {
  const { slug, taskNumber } = await params;
  const num = parseInt(taskNumber, 10);
  if (!Number.isFinite(num) || num < 1) {
    return NextResponse.json({ error: 'invalid taskNumber' }, { status: 400 });
  }
  const authd = await requireApiToken(req, ['tasks:read']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }
  const found = await resolveTask(slug, num, authd.userId);
  if (!found) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({
    implPlan: found.task.implPlan ?? null,
    implPlanAt: found.task.implPlanAt?.toISOString() ?? null,
  });
}

const postBody = z.object({ lang: z.enum(['es', 'en']).optional() }).nullable();

/**
 * Genera (o regenera) el plan de implementación de la HU con IA y lo persiste.
 * Lo llama el agente Dev al tomar la HU; también lo dispara el botón de la UI.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; taskNumber: string }> },
) {
  const { slug, taskNumber } = await params;
  const num = parseInt(taskNumber, 10);
  if (!Number.isFinite(num) || num < 1) {
    return NextResponse.json({ error: 'invalid taskNumber' }, { status: 400 });
  }
  const authd = await requireApiToken(req, ['tasks:write']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }
  const found = await resolveTask(slug, num, authd.userId);
  if (!found) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (found.role === 'VIEWER') {
    return NextResponse.json({ error: 'viewer cannot generate plans' }, { status: 403 });
  }

  const parsed = postBody.safeParse(await req.json().catch(() => null));
  const lang = (parsed.success && parsed.data?.lang) || 'es';

  let markdown: string;
  try {
    markdown = await generateTaskImplPlan({
      projectId: found.project.id,
      taskId: found.task.id,
      userId: authd.userId,
      lang,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error de IA' },
      { status: 502 },
    );
  }

  await audit({
    actorId: authd.userId,
    action: 'task.impl_plan',
    resourceType: 'task',
    resourceId: found.task.id,
    projectId: found.project.id,
    payload: { via: 'api' },
  });

  return NextResponse.json({ ok: true, implPlan: markdown }, { status: 201 });
}
