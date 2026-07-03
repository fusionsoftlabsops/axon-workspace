import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import { audit } from '@/lib/audit';
import { publishDomainEvent } from '@/lib/agents/events';
import { selfApprovalBlockReason } from '@/lib/agents/provision';

const body = z.object({
  decision: z.enum(['approve', 'reject']),
  comment: z.string().max(20_000).optional(),
});

/**
 * Veredicto de QA vía API (la superficie del agente QA): approve → estado DONE
 * (Terminada); reject → estado IN_PROGRESS (Desarrollo) con comentario
 * accionable obligatorio. Espeja qaDecisionAction (web) y aplica el
 * guardarraíl anti auto-aprobación por identidad de token.
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

  const authd = await requireApiToken(req, ['tasks:write', 'comments:write']);
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
    return NextResponse.json({ error: 'viewer cannot submit QA decisions' }, { status: 403 });
  }

  const task = await prisma.task.findUnique({
    where: { projectId_taskNumber: { projectId: project.id, taskNumber: num } },
    select: { id: true, stateId: true, assigneeId: true, qaHandoff: true },
  });
  if (!task) return NextResponse.json({ error: 'task not found' }, { status: 404 });

  const json = await req.json().catch(() => null);
  const parsed = body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 });
  }
  const { decision } = parsed.data;
  const note = (parsed.data.comment ?? '').trim();
  if (decision === 'reject' && !note) {
    return NextResponse.json({ error: 'reject requires an actionable comment' }, { status: 400 });
  }

  const targetCategory = decision === 'approve' ? 'DONE' : 'IN_PROGRESS';
  const target = project.workflows[0]?.states.find((s) => s.category === targetCategory);
  if (!target) {
    return NextResponse.json({ error: `board has no ${targetCategory} state` }, { status: 400 });
  }

  // Guardarraíl de plataforma: un agente no aprueba su propio trabajo.
  if (decision === 'approve') {
    const blocked = await selfApprovalBlockReason({
      projectId: project.id,
      actorUserId: authd.userId,
      qaHandoff: task.qaHandoff,
      assigneeId: task.assigneeId,
    });
    if (blocked) {
      await audit({
        actorId: authd.userId,
        action: 'task.self_approval_blocked',
        resourceType: 'task',
        resourceId: task.id,
        projectId: project.id,
        payload: { via: 'qa-decision', reason: blocked },
      });
      return NextResponse.json({ error: blocked }, { status: 403 });
    }
  }

  const prefix = decision === 'approve' ? '✅ QA aprobó la HU' : '❌ QA rechazó la HU';
  const commentBody = note ? `${prefix}: ${note}` : prefix;
  const stateChanged = task.stateId !== target.id;

  await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id: task.id }, data: { stateId: target.id } });
    if (stateChanged) {
      await tx.taskActivity.create({
        data: {
          taskId: task.id,
          actorId: authd.userId,
          type: 'STATE_CHANGED',
          payload: { from: task.stateId, to: target.id, via: 'qa-decision' },
        },
      });
    }
    await tx.taskComment.create({ data: { taskId: task.id, authorId: authd.userId, body: commentBody } });
    await tx.taskActivity.create({
      data: { taskId: task.id, actorId: authd.userId, type: 'COMMENTED', payload: { via: 'qa-decision' } },
    });
  });

  if (decision === 'approve') {
    const { extractMemoriesFromTaskAction } = await import('@/lib/actions/brain');
    void extractMemoriesFromTaskAction(slug, task.id, authd.userId).catch((err) => {
      console.error('[brain] post-QA-approve extraction failed (api):', err);
    });
  }

  await audit({
    actorId: authd.userId,
    action: 'task.qa_decision',
    resourceType: 'task',
    resourceId: task.id,
    projectId: project.id,
    payload: { via: 'api', decision },
  });

  if (stateChanged) {
    publishDomainEvent({
      type: 'story.state_changed',
      projectId: project.id,
      storyId: task.id,
      storyNumber: num,
      fromState: { id: task.stateId },
      toState: { id: target.id, name: target.name, category: target.category },
      actorId: authd.userId,
      assigneeId: task.assigneeId,
      payload: { via: 'qa-decision', decision },
    });
  }

  return NextResponse.json({ ok: true, decision, movedTo: target.name });
}
