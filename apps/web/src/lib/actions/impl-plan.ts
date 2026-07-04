'use server';

import { prisma } from '@/lib/db';
import { assertProjectMember } from '@/lib/auth/membership';
import { getServerLang } from '@/lib/i18n/server';
import { generateTaskImplPlan } from '@/lib/ai/impl-plan';
import type { ActionResult } from './projects';

export interface TaskDetailView {
  id: string;
  taskNumber: number;
  title: string;
  description: string;
  acceptanceCriteria: string;
  state: string;
  assignee: string | null;
  implPlan: string | null;
  implPlanAt: string | null;
}

/** Detalle de una HU para el drawer del tablero (incluye el plan de implementación). */
export async function getTaskDetailAction(
  slug: string,
  taskId: string,
): Promise<ActionResult<TaskDetailView>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  const task = await prisma.task.findFirst({
    where: { id: taskId, projectId: ctx.projectId },
    include: { state: { select: { name: true } }, assignee: { select: { name: true } } },
  });
  if (!task) return { ok: false, error: 'HU no encontrada' };
  return {
    ok: true,
    data: {
      id: task.id,
      taskNumber: task.taskNumber,
      title: task.title,
      description: task.description ?? '',
      acceptanceCriteria: task.acceptanceCriteria ?? '',
      state: task.state.name,
      assignee: task.assignee?.name ?? null,
      implPlan: task.implPlan ?? null,
      implPlanAt: task.implPlanAt?.toISOString() ?? null,
    },
  };
}

/** Genera (o regenera) el plan de implementación de la HU con IA y lo persiste. */
export async function generateTaskImplPlanAction(
  slug: string,
  taskId: string,
): Promise<ActionResult<{ implPlan: string; implPlanAt: string }>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos para generar' };
  const task = await prisma.task.findFirst({
    where: { id: taskId, projectId: ctx.projectId },
    select: { id: true },
  });
  if (!task) return { ok: false, error: 'HU no encontrada' };

  const lang = await getServerLang();
  try {
    const implPlan = await generateTaskImplPlan({
      projectId: ctx.projectId,
      taskId: task.id,
      userId: ctx.userId,
      lang,
    });
    return { ok: true, data: { implPlan, implPlanAt: new Date().toISOString() } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error de IA' };
  }
}
