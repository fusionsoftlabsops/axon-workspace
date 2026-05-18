import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import { citeMemory } from '@/lib/brain';
import { audit } from '@/lib/audit';

const body = z.object({
  taskNumber: z.number().int().positive(),
  context: z.string().max(500).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const authd = await requireApiToken(req, ['brain:write']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const project = await prisma.project.findUnique({
    where: { slug },
    select: { id: true, members: { where: { userId: authd.userId }, select: { role: true } } },
  });
  if (!project || project.members.length === 0) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }

  const task = await prisma.task.findUnique({
    where: { projectId_taskNumber: { projectId: project.id, taskNumber: parsed.data.taskNumber } },
    select: { id: true },
  });
  if (!task) return NextResponse.json({ error: 'task not found' }, { status: 404 });

  const result = await citeMemory({
    memoryId: id,
    taskId: task.id,
    userId: authd.userId,
    context: parsed.data.context,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  await audit({
    actorId: authd.userId,
    action: 'brain.cite',
    resourceType: 'memory',
    resourceId: id,
    projectId: project.id,
    payload: { taskId: task.id, via: 'api' },
  });

  return NextResponse.json({ ok: true, citationId: result.citationId }, { status: 201 });
}
