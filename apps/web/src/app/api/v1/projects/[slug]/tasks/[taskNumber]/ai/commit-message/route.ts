import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import { invokeAi } from '@/lib/ai/router';

const body = z.object({ diffSummary: z.string().min(1).max(20_000) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; taskNumber: string }> },
) {
  const { slug, taskNumber } = await params;
  const num = parseInt(taskNumber, 10);
  const authd = await requireApiToken(req, ['tasks:read']);
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
    select: {
      id: true,
      slug: true,
      members: { where: { userId: authd.userId }, select: { id: true } },
    },
  });
  if (!project || project.members.length === 0) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }

  const task = await prisma.task.findUnique({
    where: { projectId_taskNumber: { projectId: project.id, taskNumber: num } },
    select: { id: true, taskNumber: true, title: true, description: true },
  });
  if (!task) return NextResponse.json({ error: 'task not found' }, { status: 404 });

  const projectPrefix = slug.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8) || 'PROJ';
  const taskRef = `${projectPrefix}-${task.taskNumber}`;

  const context =
    `Tarea ${taskRef}\n` +
    `Título: ${task.title}\n` +
    (task.description ? `Descripción:\n${task.description}\n` : '') +
    `\nResumen del cambio:\n${parsed.data.diffSummary}`;

  try {
    const result = await invokeAi({
      purpose: 'commit.message',
      context,
      userId: authd.userId,
      projectId: project.id,
      taskId: task.id,
    });
    return NextResponse.json({ message: result.output, model: result.model });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'ai error' },
      { status: 500 },
    );
  }
}
