'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import {
  createTaskSchema,
  updateTaskSchema,
  type CreateTaskInput,
  type UpdateTaskInput,
} from '@admin/shared/schemas';
import type { ActionResult } from './projects';

type ActivityCreate = Prisma.TaskActivityCreateManyInput;

type ProjectMemberCtx = {
  ok: true;
  projectId: string;
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
};
type ProjectMemberErr = { ok: false; error: string };

async function assertProjectMember(
  projectSlug: string,
): Promise<ProjectMemberCtx | ProjectMemberErr> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'No autenticado' };

  const project = await prisma.project.findUnique({
    where: { slug: projectSlug },
    select: {
      id: true,
      members: { where: { userId }, select: { role: true } },
    },
  });
  if (!project || project.members.length === 0) {
    return { ok: false, error: 'Proyecto no encontrado' };
  }
  return { ok: true, projectId: project.id, userId, role: project.members[0]!.role };
}

export async function createTaskAction(
  projectSlug: string,
  input: CreateTaskInput,
): Promise<ActionResult<{ taskNumber: number }>> {
  const ctx = await assertProjectMember(projectSlug);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos para crear tareas' };

  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' };

  const data = parsed.data;

  const created = await prisma.$transaction(async (tx) => {
    // Atomically increment the project's task counter.
    const counter = await tx.projectTaskCounter.update({
      where: { projectId: ctx.projectId },
      data: { next: { increment: 1 } },
    });
    const taskNumber = counter.next - 1;

    const maxPos = await tx.task.aggregate({
      where: { projectId: ctx.projectId, stateId: data.stateId },
      _max: { positionInState: true },
    });
    const positionInState = (maxPos._max.positionInState ?? -1) + 1;

    const task = await tx.task.create({
      data: {
        projectId: ctx.projectId,
        taskNumber,
        parentTaskId: data.parentTaskId,
        stateId: data.stateId,
        title: data.title,
        description: data.description,
        priority: data.priority,
        assigneeId: data.assigneeId,
        reporterId: ctx.userId,
        dueDate: data.dueDate,
        positionInState,
      },
    });

    await tx.taskActivity.create({
      data: {
        taskId: task.id,
        actorId: ctx.userId,
        type: 'CREATED',
        payload: { title: task.title, stateId: task.stateId },
      },
    });

    return task;
  });

  revalidatePath(`/projects/${projectSlug}/board`);
  return { ok: true, data: { taskNumber: created.taskNumber } };
}

export async function updateTaskAction(
  projectSlug: string,
  input: UpdateTaskInput,
): Promise<ActionResult> {
  const ctx = await assertProjectMember(projectSlug);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };

  const parsed = updateTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' };

  const { id, ...rest } = parsed.data;
  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing || existing.projectId !== ctx.projectId) {
    return { ok: false, error: 'Tarea no encontrada' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id }, data: rest });

    // Record activity for tracked field changes.
    const activities: ActivityCreate[] = [];
    if (rest.stateId && rest.stateId !== existing.stateId) {
      activities.push({
        taskId: id,
        actorId: ctx.userId,
        type: 'STATE_CHANGED',
        payload: { from: existing.stateId, to: rest.stateId },
      });
    }
    if (rest.assigneeId !== undefined && rest.assigneeId !== existing.assigneeId) {
      activities.push({
        taskId: id,
        actorId: ctx.userId,
        type: rest.assigneeId ? 'ASSIGNED' : 'UNASSIGNED',
        payload: { from: existing.assigneeId, to: rest.assigneeId ?? null },
      });
    }
    if (rest.priority && rest.priority !== existing.priority) {
      activities.push({
        taskId: id,
        actorId: ctx.userId,
        type: 'PRIORITY_CHANGED',
        payload: { from: existing.priority, to: rest.priority },
      });
    }
    if (rest.title && rest.title !== existing.title) {
      activities.push({
        taskId: id,
        actorId: ctx.userId,
        type: 'TITLE_CHANGED',
        payload: { from: existing.title, to: rest.title },
      });
    }

    if (activities.length > 0) {
      await tx.taskActivity.createMany({ data: activities });
    }
  });

  revalidatePath(`/projects/${projectSlug}/board`);
  return { ok: true };
}

/**
 * Move a task within or across columns. Updates state + position atomically.
 * `siblingIds` is the ordered list of task IDs in the target column AFTER the move.
 */
export async function moveTaskAction(
  projectSlug: string,
  taskId: string,
  toStateId: string,
  siblingIds: string[],
): Promise<ActionResult> {
  const ctx = await assertProjectMember(projectSlug);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || task.projectId !== ctx.projectId) {
    return { ok: false, error: 'Tarea no encontrada' };
  }

  // Resolve target state category to decide whether to fire the brain extractor.
  const toState = await prisma.workflowState.findUnique({
    where: { id: toStateId },
    select: { category: true },
  });
  const stateChanged = task.stateId !== toStateId;
  const enteringDone = stateChanged && toState?.category === 'DONE';

  await prisma.$transaction(async (tx) => {
    // Update positions of all siblings in the target column.
    await Promise.all(
      siblingIds.map((id, idx) =>
        tx.task.update({
          where: { id },
          data: { stateId: toStateId, positionInState: idx },
        }),
      ),
    );

    if (stateChanged) {
      await tx.taskActivity.create({
        data: {
          taskId,
          actorId: ctx.userId,
          type: 'STATE_CHANGED',
          payload: { from: task.stateId, to: toStateId },
        },
      });
    }
  });

  // Fire-and-forget: when a task enters a DONE column, extract memories into
  // the actor's local brain. Failures (no API key, etc.) are swallowed by the
  // extractor itself; we just log them so they appear in the dev console.
  if (enteringDone) {
    const { extractMemoriesFromTaskAction } = await import('./brain');
    void extractMemoriesFromTaskAction(projectSlug, taskId, ctx.userId).catch((err) => {
      console.error('[brain] post-close extraction failed:', err);
    });
  }

  revalidatePath(`/projects/${projectSlug}/board`);
  return { ok: true };
}

export async function addCommentAction(
  projectSlug: string,
  taskId: string,
  body: string,
): Promise<ActionResult> {
  const ctx = await assertProjectMember(projectSlug);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };

  const trimmed = body.trim();
  if (trimmed.length === 0) return { ok: false, error: 'Comentario vacío' };

  await prisma.$transaction(async (tx) => {
    await tx.taskComment.create({
      data: { taskId, authorId: ctx.userId, body: trimmed },
    });
    await tx.taskActivity.create({
      data: { taskId, actorId: ctx.userId, type: 'COMMENTED' },
    });
  });

  revalidatePath(`/projects/${projectSlug}/board`);
  return { ok: true };
}

export async function deleteTaskAction(
  projectSlug: string,
  taskId: string,
): Promise<ActionResult> {
  const ctx = await assertProjectMember(projectSlug);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  if (ctx.role !== 'OWNER' && ctx.role !== 'ADMIN') {
    return { ok: false, error: 'Solo OWNER/ADMIN puede eliminar tareas' };
  }

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || task.projectId !== ctx.projectId) {
    return { ok: false, error: 'Tarea no encontrada' };
  }

  await prisma.task.delete({ where: { id: taskId } });
  revalidatePath(`/projects/${projectSlug}/board`);
  return { ok: true };
}
