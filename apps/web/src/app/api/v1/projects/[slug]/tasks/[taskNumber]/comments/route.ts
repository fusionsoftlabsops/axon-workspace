import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';

const body = z.object({ body: z.string().min(1).max(20_000) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; taskNumber: string }> },
) {
  const { slug, taskNumber } = await params;
  const num = parseInt(taskNumber, 10);
  if (!Number.isFinite(num) || num < 1) {
    return NextResponse.json({ error: 'invalid taskNumber' }, { status: 400 });
  }

  const authd = await requireApiToken(req, ['comments:write']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }

  const project = await prisma.project.findUnique({
    where: { slug },
    select: {
      id: true,
      members: { where: { userId: authd.userId }, select: { role: true } },
    },
  });
  if (!project || project.members.length === 0) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }
  if (project.members[0]!.role === 'VIEWER') {
    return NextResponse.json({ error: 'viewer cannot comment' }, { status: 403 });
  }

  const task = await prisma.task.findUnique({
    where: { projectId_taskNumber: { projectId: project.id, taskNumber: num } },
    select: { id: true },
  });
  if (!task) return NextResponse.json({ error: 'task not found' }, { status: 404 });

  const json = await req.json().catch(() => null);
  const parsed = body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const created = await prisma.taskComment.create({
    data: { taskId: task.id, authorId: authd.userId, body: parsed.data.body.trim() },
  });

  return NextResponse.json({ id: created.id, createdAt: created.createdAt.toISOString() }, { status: 201 });
}
