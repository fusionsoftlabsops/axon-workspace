'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getServerLang } from '@/lib/i18n/server';
import { generateQaTests } from '@/lib/ai/planner';
import { audit } from '@/lib/audit';
import {
  asHandoff,
  asQaTests,
  formatQaHandoffComment,
  type QaHandoff,
  type QaTests,
} from '@/lib/qa-types';
import type { ActionResult } from './projects';

async function assertProjectMember(projectSlug: string) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false as const, error: 'No autenticado' };
  const project = await prisma.project.findUnique({
    where: { slug: projectSlug },
    select: { id: true, members: { where: { userId }, select: { role: true } } },
  });
  if (!project || project.members.length === 0) {
    return { ok: false as const, error: 'Proyecto no encontrado' };
  }
  return { ok: true as const, projectId: project.id, userId, role: project.members[0]!.role };
}

export interface QaTaskView {
  id: string;
  taskNumber: number;
  title: string;
  description: string;
  acceptanceCriteria: string;
  assignee: { id: string; name: string | null } | null;
  handoff: QaHandoff | null;
  qaTests: QaTests | null;
  commentCount: number;
}

function toQaView(t: {
  id: string;
  taskNumber: number;
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  assignee: { id: string; name: string | null } | null;
  qaHandoff: unknown;
  qaTests: unknown;
  _count?: { comments: number };
}): QaTaskView {
  return {
    id: t.id,
    taskNumber: t.taskNumber,
    title: t.title,
    description: t.description ?? '',
    acceptanceCriteria: t.acceptanceCriteria ?? '',
    assignee: t.assignee,
    handoff: asHandoff(t.qaHandoff),
    qaTests: asQaTests(t.qaTests),
    commentCount: t._count?.comments ?? 0,
  };
}

const qaTaskSelect = {
  id: true,
  taskNumber: true,
  title: true,
  description: true,
  acceptanceCriteria: true,
  qaHandoff: true,
  qaTests: true,
  assignee: { select: { id: true, name: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.TaskSelect;

/** All stories currently in the Verificación (REVIEW category) state, for the QA view. */
export async function loadQaQueue(projectId: string): Promise<QaTaskView[]> {
  const rows = await prisma.task.findMany({
    where: { projectId, state: { category: 'REVIEW' } },
    orderBy: { updatedAt: 'desc' },
    select: qaTaskSelect,
  });
  return rows.map(toQaView);
}

/** Generate QA test cases (AI) for a story in the QA queue and persist them. */
export async function generateQaTestsAction(
  slug: string,
  taskId: string,
): Promise<ActionResult<QaTaskView>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { ...qaTaskSelect, projectId: true },
  });
  if (!task || task.projectId !== ctx.projectId) {
    return { ok: false, error: 'Tarea no encontrada' };
  }

  const handoff = asHandoff(task.qaHandoff);
  const lang = await getServerLang();
  let tests;
  try {
    tests = await generateQaTests(
      {
        title: task.title,
        description: task.description ?? '',
        acceptanceCriteria: task.acceptanceCriteria ?? '',
        handoffContext: handoff ? formatQaHandoffComment(handoff) : undefined,
      },
      lang,
      ctx.userId,
      ctx.projectId,
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error de IA' };
  }

  const qaTests: QaTests = { tests, generatedAt: new Date().toISOString() };
  const updated = await prisma.task.update({
    where: { id: taskId },
    data: { qaTests: qaTests as unknown as Prisma.InputJsonValue },
    select: qaTaskSelect,
  });
  revalidatePath(`/projects/${slug}/qa`);
  return { ok: true, data: toQaView(updated) };
}

/** QA verdict: approve → move to a DONE state; reject → back to an IN_PROGRESS
 *  state. A comment is posted (required on reject). */
export async function qaDecisionAction(
  slug: string,
  taskId: string,
  decision: 'approve' | 'reject',
  comment?: string,
): Promise<ActionResult> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };

  const note = (comment ?? '').trim();
  if (decision === 'reject' && !note) {
    return { ok: false, error: 'Indica el motivo del rechazo' };
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, projectId: true, stateId: true },
  });
  if (!task || task.projectId !== ctx.projectId) return { ok: false, error: 'Tarea no encontrada' };

  const targetCategory = decision === 'approve' ? 'DONE' : 'IN_PROGRESS';
  const workflow = await prisma.workflow.findFirst({
    where: { projectId: ctx.projectId, isDefault: true },
    select: { states: { orderBy: { order: 'asc' }, select: { id: true, category: true } } },
  });
  const target = workflow?.states.find((s) => s.category === targetCategory);
  if (!target) return { ok: false, error: `No existe un estado ${targetCategory} en el tablero` };

  const prefix = decision === 'approve' ? '✅ QA aprobó la HU' : '❌ QA rechazó la HU';
  const body = note ? `${prefix}: ${note}` : prefix;

  await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id: taskId }, data: { stateId: target.id } });
    if (task.stateId !== target.id) {
      await tx.taskActivity.create({
        data: {
          taskId,
          actorId: ctx.userId,
          type: 'STATE_CHANGED',
          payload: { from: task.stateId, to: target.id, via: 'qa' },
        },
      });
    }
    await tx.taskComment.create({ data: { taskId, authorId: ctx.userId, body } });
    await tx.taskActivity.create({
      data: { taskId, actorId: ctx.userId, type: 'COMMENTED', payload: { via: 'qa' } },
    });
  });

  if (decision === 'approve') {
    const { extractMemoriesFromTaskAction } = await import('./brain');
    void extractMemoriesFromTaskAction(slug, taskId, ctx.userId).catch((err) => {
      console.error('[brain] post-QA-approve extraction failed:', err);
    });
  }

  await audit({
    actorId: ctx.userId,
    action: 'task.qa_decision',
    resourceType: 'task',
    resourceId: taskId,
    projectId: ctx.projectId,
    payload: { decision },
  });

  revalidatePath(`/projects/${slug}/qa`);
  revalidatePath(`/projects/${slug}/board`);
  return { ok: true };
}
