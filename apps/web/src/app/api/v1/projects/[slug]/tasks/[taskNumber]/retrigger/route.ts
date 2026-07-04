import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import { audit } from '@/lib/audit';
import { publishDomainEvent } from '@/lib/agents/events';

/**
 * Re-emite el evento de dominio de UNA HU sin moverla de estado — la versión
 * quirúrgica del botón «Verificar y reactivar». La usa el supervisor de consola
 * para despertar al agente que corresponde según el estado actual:
 *   backlog (OPEN) → story.created (PO/Dax/Aria/SM) · resto → story.state_changed
 *   (Desarrollo→Dev · Verificación→QA+Reviewer · Hecho→PO DoD/Release).
 * Si hay una corrida RUNNING sobre la HU, no dispara (evita duplicar trabajo)
 * salvo `force: true`.
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
  const project = await prisma.project.findUnique({
    where: { slug },
    select: { id: true, members: { where: { userId: authd.userId }, select: { role: true } } },
  });
  if (!project || project.members.length === 0) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }
  if (project.members[0]!.role === 'VIEWER') {
    return NextResponse.json({ error: 'viewer cannot retrigger' }, { status: 403 });
  }
  const task = await prisma.task.findUnique({
    where: { projectId_taskNumber: { projectId: project.id, taskNumber: num } },
    select: {
      id: true,
      taskNumber: true,
      assigneeId: true,
      state: { select: { id: true, name: true, category: true } },
    },
  });
  if (!task) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { force?: boolean } | null;
  if (!body?.force) {
    const running = await prisma.agentRun.findFirst({
      where: { storyId: task.id, status: 'RUNNING' },
      select: { id: true },
    });
    if (running) {
      return NextResponse.json(
        { ok: false, skipped: 'RUNNING', error: 'Hay una corrida en vuelo sobre esta HU (usá force para disparar igual)' },
        { status: 409 },
      );
    }
  }

  const type = task.state.category === 'OPEN' ? 'story.created' : 'story.state_changed';
  publishDomainEvent({
    type,
    projectId: project.id,
    storyId: task.id,
    storyNumber: task.taskNumber,
    toState: { id: task.state.id, name: task.state.name, category: task.state.category },
    actorId: authd.userId,
    assigneeId: task.assigneeId ?? null,
  });

  await audit({
    actorId: authd.userId,
    action: 'task.update',
    resourceType: 'task',
    resourceId: task.id,
    projectId: project.id,
    payload: { via: 'retrigger', type, state: task.state.name },
  });

  return NextResponse.json({ ok: true, refired: type, state: task.state.name }, { status: 200 });
}
