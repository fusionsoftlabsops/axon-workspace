import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import { extractMemoriesFromTaskAction } from '@/lib/actions/brain';

const bodySchema = z.object({ taskNumber: z.number().int().positive() });

/**
 * POST /api/v1/projects/[slug]/brain/extract  { taskNumber }
 *
 * Run the AI extractor on a task and return the persisted LOCAL memories.
 * Useful for Claude Code to invoke at end-of-task even when the close was
 * done outside the platform (e.g. without moving the kanban card).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const authd = await requireApiToken(req, ['brain:write']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const project = await prisma.project.findUnique({
    where: { slug },
    select: { id: true, members: { where: { userId: authd.userId }, select: { id: true } } },
  });
  if (!project || project.members.length === 0) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }

  const task = await prisma.task.findUnique({
    where: { projectId_taskNumber: { projectId: project.id, taskNumber: parsed.data.taskNumber } },
    select: { id: true },
  });
  if (!task) return NextResponse.json({ error: 'task not found' }, { status: 404 });

  const result = await extractMemoriesFromTaskAction(slug, task.id, authd.userId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true, memoryIds: result.data?.memoryIds ?? [] });
}
