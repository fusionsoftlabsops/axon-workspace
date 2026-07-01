import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import { audit } from '@/lib/audit';
import { formatQaHandoffComment, type QaHandoff, type QaTestCase } from '@/lib/qa-types';
import type { Prisma } from '@prisma/client';

const testCase = z.object({
  title: z.string().min(1).max(500),
  steps: z.string().max(4000).optional(),
  expected: z.string().max(2000).optional(),
});

const body = z.object({
  criteria: z.array(z.object({ text: z.string().min(1).max(1000), met: z.boolean() })).max(50).optional(),
  suggestedTests: z.array(z.union([z.string().min(1).max(2000), testCase])).max(50).optional(),
  executedTasks: z.array(z.string().min(1).max(1000)).max(100).optional(),
  notes: z.string().max(8000).optional(),
  moveToVerification: z.boolean().optional().default(true),
});

/**
 * Developer→QA handoff for closing an HU (called by the /cerrar-hu Fusion Code
 * skill via the submit_qa_review MCP tool). Stores the handoff, posts a formatted
 * comment, and moves the task to the Verificación (REVIEW category) state.
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
    select: {
      id: true,
      members: { where: { userId: authd.userId }, select: { role: true } },
      workflows: { where: { isDefault: true }, include: { states: { orderBy: { order: 'asc' } } } },
    },
  });
  if (!project || project.members.length === 0) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }
  if (project.members[0]!.role === 'VIEWER') {
    return NextResponse.json({ error: 'viewer cannot submit QA reviews' }, { status: 403 });
  }

  const task = await prisma.task.findUnique({
    where: { projectId_taskNumber: { projectId: project.id, taskNumber: num } },
    select: { id: true, stateId: true },
  });
  if (!task) return NextResponse.json({ error: 'task not found' }, { status: 404 });

  const json = await req.json().catch(() => null);
  const parsed = body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 });
  }
  const data = parsed.data;

  const suggestedTests: QaTestCase[] = (data.suggestedTests ?? []).map((t) =>
    typeof t === 'string' ? { title: t } : t,
  );
  const handoff: QaHandoff = {
    criteria: data.criteria ?? [],
    suggestedTests,
    executedTasks: data.executedTasks ?? [],
    notes: data.notes,
    submittedAt: new Date().toISOString(),
    submittedById: authd.userId,
  };

  // Resolve the Verificación (REVIEW) state to move into, if requested.
  const reviewState = project.workflows[0]?.states.find((s) => s.category === 'REVIEW');
  const willMove = data.moveToVerification && reviewState && reviewState.id !== task.stateId;

  await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: task.id },
      data: {
        qaHandoff: handoff as unknown as Prisma.InputJsonValue,
        ...(willMove ? { stateId: reviewState!.id } : {}),
      },
    });
    if (willMove) {
      await tx.taskActivity.create({
        data: {
          taskId: task.id,
          actorId: authd.userId,
          type: 'STATE_CHANGED',
          payload: { from: task.stateId, to: reviewState!.id, via: 'qa-review' },
        },
      });
    }
    await tx.taskComment.create({
      data: { taskId: task.id, authorId: authd.userId, body: formatQaHandoffComment(handoff) },
    });
    await tx.taskActivity.create({
      data: { taskId: task.id, actorId: authd.userId, type: 'COMMENTED', payload: { via: 'qa-review' } },
    });
  });

  await audit({
    actorId: authd.userId,
    action: 'task.qa_review',
    resourceType: 'task',
    resourceId: task.id,
    projectId: project.id,
    payload: { via: 'api', moved: !!willMove },
  });

  return NextResponse.json({ ok: true, movedToVerification: !!willMove });
}
