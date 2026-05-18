'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { MemoryType } from '@prisma/client';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { assertProjectMember } from '@/lib/auth/membership';
import {
  citeMemory,
  extractMemoriesFromTask,
  pullProjectBrain,
  searchBrain,
  type MemoryDraft,
  type PullResult,
  type SearchFilters,
  type SearchResult,
} from '@/lib/brain';
import type { ActionResult } from './projects';

const memoryTypeEnum = z.enum([
  'DECISION',
  'GOTCHA',
  'PATTERN',
  'ANTIPATTERN',
  'RUNBOOK',
  'GLOSSARY',
  'NOTE',
]);

const captureSchema = z.object({
  type: memoryTypeEnum,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
  tags: z.array(z.string().min(1).max(40)).max(8).default([]),
  sourceTaskNumber: z.number().int().positive().optional(),
  scope: z.enum(['LOCAL', 'PROJECT']).default('LOCAL'),
});

export type CaptureMemoryInput = z.infer<typeof captureSchema>;

/** Create a memory by hand. Default scope is LOCAL (private to the author). */
export async function captureMemoryAction(
  projectSlug: string,
  input: CaptureMemoryInput,
): Promise<ActionResult<{ memoryId: string }>> {
  const ctx = await assertProjectMember(projectSlug);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos para capturar memorias' };

  const parsed = captureSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' };
  const data = parsed.data;

  let sourceTaskId: string | null = null;
  if (data.sourceTaskNumber) {
    const task = await prisma.task.findUnique({
      where: { projectId_taskNumber: { projectId: ctx.projectId, taskNumber: data.sourceTaskNumber } },
      select: { id: true },
    });
    if (!task) return { ok: false, error: 'Tarea origen no encontrada' };
    sourceTaskId = task.id;
  }

  const created = await prisma.brainMemory.create({
    data: {
      projectId: ctx.projectId,
      scope: data.scope,
      ownerUserId: data.scope === 'LOCAL' ? ctx.userId : null,
      authorId: ctx.userId,
      type: data.type,
      title: data.title,
      body: data.body,
      tags: data.tags,
      sourceTaskId,
    },
    select: { id: true },
  });

  await audit({
    actorId: ctx.userId,
    action: 'brain.capture',
    resourceType: 'memory',
    resourceId: created.id,
    projectId: ctx.projectId,
    payload: { scope: data.scope, type: data.type, title: data.title },
  });

  revalidatePath(`/projects/${projectSlug}/brain`);
  return { ok: true, data: { memoryId: created.id } };
}

/**
 * Extract memories from a closed task using the AI router, persist them as
 * LOCAL drafts for the actor, log a MEMORY_CAPTURED activity entry on the
 * task. Returns the persisted memories so the UI can offer "publish" / "edit"
 * actions.
 *
 * Safe to call as fire-and-forget from a state-change hook — if extraction
 * fails, we record the failure in the audit log but do not throw.
 */
export async function extractMemoriesFromTaskAction(
  projectSlug: string,
  taskId: string,
  actorUserId?: string,
): Promise<ActionResult<{ memoryIds: string[] }>> {
  // Allow callers from a hook context to pass actorUserId explicitly so we
  // don't depend on the request session (which may not exist by the time the
  // fire-and-forget runs).
  let userId = actorUserId;
  if (!userId) {
    const session = await auth();
    userId = session?.user?.id;
  }
  if (!userId) return { ok: false, error: 'No autenticado' };

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, projectId: true, project: { select: { slug: true } } },
  });
  if (!task || task.project.slug !== projectSlug) {
    return { ok: false, error: 'Tarea no encontrada' };
  }

  const result = await extractMemoriesFromTask(taskId, userId);

  let persisted: string[] = [];
  if (result.drafts.length > 0) {
    persisted = await persistDrafts({
      drafts: result.drafts,
      projectId: task.projectId,
      taskId: task.id,
      authorId: userId,
    });
  }

  await audit({
    actorId: userId,
    action: 'brain.extract',
    resourceType: 'task',
    resourceId: task.id,
    projectId: task.projectId,
    payload: {
      drafts: result.drafts.length,
      model: result.model,
      estimatedCostUsd: result.estimatedCostUsd,
    },
  });

  if (persisted.length > 0) {
    await prisma.taskActivity.create({
      data: {
        taskId: task.id,
        actorId: userId,
        type: 'MEMORY_CAPTURED',
        payload: { count: persisted.length, model: result.model },
      },
    });
  }

  revalidatePath(`/projects/${projectSlug}/brain`);
  return { ok: true, data: { memoryIds: persisted } };
}

async function persistDrafts(opts: {
  drafts: MemoryDraft[];
  projectId: string;
  taskId: string;
  authorId: string;
}): Promise<string[]> {
  const created = await Promise.all(
    opts.drafts.map((d) =>
      prisma.brainMemory.create({
        data: {
          projectId: opts.projectId,
          scope: 'LOCAL',
          ownerUserId: opts.authorId,
          authorId: opts.authorId,
          type: d.type,
          title: d.title,
          body: d.body,
          tags: d.tags,
          sourceTaskId: opts.taskId,
        },
        select: { id: true },
      }),
    ),
  );
  return created.map((m) => m.id);
}

/**
 * Promote a LOCAL memory to PROJECT scope (auto-accept policy: no review
 * queue). Only the memory's owner or an OWNER/ADMIN of the project can publish.
 */
export async function publishMemoryAction(memoryId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'No autenticado' };

  const memory = await prisma.brainMemory.findUnique({
    where: { id: memoryId },
    select: {
      id: true,
      projectId: true,
      scope: true,
      ownerUserId: true,
      project: { select: { slug: true, members: { where: { userId }, select: { role: true } } } },
    },
  });
  if (!memory) return { ok: false, error: 'Memoria no encontrada' };
  if (memory.project.members.length === 0) return { ok: false, error: 'Sin acceso al proyecto' };
  if (memory.scope === 'PROJECT') return { ok: false, error: 'La memoria ya está publicada' };

  const role = memory.project.members[0]!.role;
  const isOwner = memory.ownerUserId === userId;
  if (!isOwner && role !== 'OWNER' && role !== 'ADMIN') {
    return { ok: false, error: 'Solo el autor de la memoria o un OWNER/ADMIN puede publicarla' };
  }

  await prisma.brainMemory.update({
    where: { id: memory.id },
    data: { scope: 'PROJECT', ownerUserId: null },
  });

  await audit({
    actorId: userId,
    action: 'brain.publish',
    resourceType: 'memory',
    resourceId: memory.id,
    projectId: memory.projectId,
  });

  revalidatePath(`/projects/${memory.project.slug}/brain`);
  return { ok: true };
}

/**
 * Replace a memory with a new one that supersedes it. Old memory is marked
 * `SUPERSEDED` (keeps the lineage); new one is `ACTIVE` and links back.
 */
export async function supersedeMemoryAction(
  oldId: string,
  next: { title?: string; body: string; type?: MemoryType; tags?: string[] },
): Promise<ActionResult<{ newMemoryId: string }>> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'No autenticado' };

  const old = await prisma.brainMemory.findUnique({
    where: { id: oldId },
    select: {
      id: true,
      projectId: true,
      scope: true,
      ownerUserId: true,
      title: true,
      type: true,
      tags: true,
      project: { select: { slug: true, members: { where: { userId }, select: { role: true } } } },
    },
  });
  if (!old) return { ok: false, error: 'Memoria no encontrada' };
  if (old.project.members.length === 0) return { ok: false, error: 'Sin acceso al proyecto' };

  const newMemory = await prisma.$transaction(async (tx) => {
    const created = await tx.brainMemory.create({
      data: {
        projectId: old.projectId,
        scope: old.scope,
        ownerUserId: old.scope === 'LOCAL' ? old.ownerUserId : null,
        authorId: userId,
        type: next.type ?? old.type,
        title: next.title ?? old.title,
        body: next.body,
        tags: next.tags ?? old.tags,
      },
      select: { id: true },
    });
    await tx.brainMemory.update({
      where: { id: old.id },
      data: { status: 'SUPERSEDED', supersededById: created.id },
    });
    return created;
  });

  await audit({
    actorId: userId,
    action: 'brain.supersede',
    resourceType: 'memory',
    resourceId: newMemory.id,
    projectId: old.projectId,
    payload: { supersededId: old.id },
  });

  revalidatePath(`/projects/${old.project.slug}/brain`);
  return { ok: true, data: { newMemoryId: newMemory.id } };
}

export async function deprecateMemoryAction(memoryId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'No autenticado' };

  const memory = await prisma.brainMemory.findUnique({
    where: { id: memoryId },
    select: {
      id: true,
      projectId: true,
      project: { select: { slug: true, members: { where: { userId }, select: { role: true } } } },
    },
  });
  if (!memory) return { ok: false, error: 'Memoria no encontrada' };
  if (memory.project.members.length === 0) return { ok: false, error: 'Sin acceso al proyecto' };

  await prisma.brainMemory.update({
    where: { id: memoryId },
    data: { status: 'DEPRECATED' },
  });

  await audit({
    actorId: userId,
    action: 'brain.deprecate',
    resourceType: 'memory',
    resourceId: memoryId,
    projectId: memory.projectId,
  });

  revalidatePath(`/projects/${memory.project.slug}/brain`);
  return { ok: true };
}

const searchSchema = z.object({
  query: z.string().max(500).optional(),
  scope: z.array(z.enum(['LOCAL', 'PROJECT'])).optional(),
  type: z.array(memoryTypeEnum).optional(),
  tags: z.array(z.string()).optional(),
  authorId: z.string().cuid().optional(),
  staleOnly: z.boolean().optional(),
  orphansOnly: z.boolean().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export async function searchBrainAction(
  projectSlug: string,
  input: z.infer<typeof searchSchema>,
): Promise<{ ok: true; data: SearchResult[] } | { ok: false; error: string }> {
  const ctx = await assertProjectMember(projectSlug);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Filtros inválidos' };

  const data = await searchBrain({
    projectId: ctx.projectId,
    requesterUserId: ctx.userId,
    includeAllLocals: ctx.role === 'OWNER',
    query: parsed.data.query,
    limit: parsed.data.limit,
    filters: {
      scope: parsed.data.scope,
      type: parsed.data.type,
      tags: parsed.data.tags,
      ...(parsed.data.authorId ? { authorId: parsed.data.authorId } : {}),
      ...(parsed.data.staleOnly ? { staleOnly: true } : {}),
      ...(parsed.data.orphansOnly ? { orphansOnly: true } : {}),
    } as SearchFilters,
  });

  return { ok: true, data };
}

export async function pullProjectBrainAction(
  projectSlug: string,
): Promise<{ ok: true; data: PullResult } | { ok: false; error: string }> {
  const ctx = await assertProjectMember(projectSlug);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const data = await pullProjectBrain({
    userId: ctx.userId,
    projectId: ctx.projectId,
    projectSlug,
  });
  await audit({
    actorId: ctx.userId,
    action: 'brain.pull',
    resourceType: 'project',
    resourceId: ctx.projectId,
    projectId: ctx.projectId,
    payload: { count: data.count, since: data.lastPulledAt },
  });
  return { ok: true, data };
}

export async function citeMemoryAction(
  projectSlug: string,
  args: { memoryId: string; taskNumber: number; context?: string },
): Promise<ActionResult> {
  const ctx = await assertProjectMember(projectSlug);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };

  const task = await prisma.task.findUnique({
    where: { projectId_taskNumber: { projectId: ctx.projectId, taskNumber: args.taskNumber } },
    select: { id: true },
  });
  if (!task) return { ok: false, error: 'Tarea no encontrada' };

  const result = await citeMemory({
    memoryId: args.memoryId,
    taskId: task.id,
    userId: ctx.userId,
    context: args.context,
  });
  if (!result.ok) return { ok: false, error: result.error };

  await audit({
    actorId: ctx.userId,
    action: 'brain.cite',
    resourceType: 'memory',
    resourceId: args.memoryId,
    projectId: ctx.projectId,
    payload: { taskId: task.id, context: args.context ?? null },
  });

  revalidatePath(`/projects/${projectSlug}/brain`);
  return { ok: true };
}
