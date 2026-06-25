'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { assertProjectMember } from '@/lib/auth/membership';
import { getServerLang } from '@/lib/i18n/server';
import { planChatReply, generatePlan, type ChatMsg } from '@/lib/ai/planner';
import {
  generatedPlanSchema,
  normalizeCategory,
  normalizeKind,
  normalizePriority,
  type GeneratedPlan,
} from '@/lib/ai/plan-schema';
import type { ActionResult } from './projects';

export interface PlanView {
  id: string;
  status: 'CHATTING' | 'GENERATING' | 'READY' | 'PUBLISHED' | 'FAILED';
  messages: ChatMsg[];
  generated: GeneratedPlan | null;
  improvedIdea: string | null;
  error: string | null;
}

async function projectMeta(projectId: string) {
  return prisma.project.findUnique({ where: { id: projectId }, select: { name: true, description: true } });
}

function toView(p: {
  id: string;
  status: string;
  messages: unknown;
  generated: unknown;
  improvedIdea: string | null;
  error: string | null;
}): PlanView {
  return {
    id: p.id,
    status: p.status as PlanView['status'],
    messages: Array.isArray(p.messages) ? (p.messages as unknown as ChatMsg[]) : [],
    generated: p.generated ? (p.generated as GeneratedPlan) : null,
    improvedIdea: p.improvedIdea,
    error: p.error,
  };
}

/** Load the active plan for a project, creating it (with a seeded opening) if none. */
export async function getOrCreatePlanAction(slug: string): Promise<ActionResult<PlanView>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;

  const existing = await prisma.projectPlan.findFirst({
    where: { projectId: ctx.projectId },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return { ok: true, data: toView(existing) };

  const meta = await projectMeta(ctx.projectId);
  const lang = await getServerLang();
  const opening =
    lang === 'es'
      ? `¡Hola! Vamos a planear «${meta?.name}». Para empezar: ¿cuál es el problema principal que resuelve y para quién? Cuando tengamos contexto suficiente, pulsa "Generar plan".`
      : `Hi! Let's plan "${meta?.name}". To start: what's the core problem it solves, and for whom? Once we have enough context, hit "Generate plan".`;

  const created = await prisma.projectPlan.create({
    data: {
      projectId: ctx.projectId,
      createdById: ctx.userId,
      status: 'CHATTING',
      messages: [{ role: 'assistant', content: opening }] as unknown as Prisma.InputJsonValue,
    },
  });
  return { ok: true, data: toView(created) };
}

/** One chat turn: append the user's message, get the assistant's reply. */
export async function planChatAction(slug: string, userMessage: string): Promise<ActionResult<PlanView>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };
  const text = userMessage.trim();
  if (!text) return { ok: false, error: 'Mensaje vacío' };

  const plan = await prisma.projectPlan.findFirst({
    where: { projectId: ctx.projectId },
    orderBy: { createdAt: 'desc' },
  });
  if (!plan) return { ok: false, error: 'Plan no encontrado' };
  if (plan.status === 'GENERATING') return { ok: false, error: 'Generando el plan…' };

  const history: ChatMsg[] = Array.isArray(plan.messages) ? (plan.messages as unknown as ChatMsg[]) : [];
  const withUser: ChatMsg[] = [...history, { role: 'user', content: text.slice(0, 4000) }];

  const meta = await projectMeta(ctx.projectId);
  let reply: string;
  try {
    reply = await planChatReply(
      { name: meta?.name ?? '', description: meta?.description ?? null },
      withUser,
      ctx.userId,
      ctx.projectId,
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error de IA' };
  }

  const next: ChatMsg[] = [...withUser, { role: 'assistant', content: reply }];
  const updated = await prisma.projectPlan.update({
    where: { id: plan.id },
    data: { messages: next as unknown as Prisma.InputJsonValue, status: plan.status === 'PUBLISHED' ? 'PUBLISHED' : 'CHATTING' },
  });
  return { ok: true, data: toView(updated) };
}

/** Kick off Opus plan generation in the background; UI polls GET /plan. */
export async function startPlanGenerationAction(slug: string): Promise<ActionResult> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };

  const plan = await prisma.projectPlan.findFirst({
    where: { projectId: ctx.projectId },
    orderBy: { createdAt: 'desc' },
  });
  if (!plan) return { ok: false, error: 'Plan no encontrado' };
  if (plan.status === 'GENERATING') return { ok: true };

  const messages: ChatMsg[] = Array.isArray(plan.messages) ? (plan.messages as unknown as ChatMsg[]) : [];
  await prisma.projectPlan.update({ where: { id: plan.id }, data: { status: 'GENERATING', error: null } });

  // Fire-and-forget: the container is a long-lived Node server, so this keeps
  // running after the action returns. The UI polls the plan status.
  void runPlanGeneration(plan.id, ctx.projectId, ctx.userId, messages);
  return { ok: true };
}

async function runPlanGeneration(
  planId: string,
  projectId: string,
  userId: string,
  messages: ChatMsg[],
): Promise<void> {
  try {
    const meta = await projectMeta(projectId);
    const plan = await generatePlan(
      { name: meta?.name ?? '', description: meta?.description ?? null },
      messages,
      userId,
      projectId,
    );
    await prisma.projectPlan.update({
      where: { id: planId },
      data: {
        status: 'READY',
        generated: plan as unknown as Prisma.InputJsonValue,
        improvedIdea: plan.improvedIdea || null,
        suggestedRepos: plan.suggestedRepos as unknown as Prisma.InputJsonValue,
        error: null,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[planning] generation failed:', err);
    await prisma.projectPlan
      .update({
        where: { id: planId },
        data: { status: 'FAILED', error: err instanceof Error ? err.message : 'Error generando el plan' },
      })
      .catch(() => {});
  }
}

/** Publish a READY plan: bulk-create sprints + tasks into the board (Preparación). */
export async function publishPlanAction(slug: string): Promise<ActionResult<{ tasks: number; sprints: number }>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };

  const plan = await prisma.projectPlan.findFirst({
    where: { projectId: ctx.projectId },
    orderBy: { createdAt: 'desc' },
  });
  if (!plan || !plan.generated) return { ok: false, error: 'No hay un plan generado' };
  if (plan.status === 'PUBLISHED') return { ok: false, error: 'El plan ya fue publicado' };

  const parsed = generatedPlanSchema.safeParse(plan.generated);
  if (!parsed.success) return { ok: false, error: 'Plan inválido' };
  const gen = parsed.data;

  const workflow = await prisma.workflow.findFirst({
    where: { projectId: ctx.projectId, isDefault: true },
    include: { states: { orderBy: { order: 'asc' }, take: 1 } },
  });
  const firstState = workflow?.states[0];
  if (!firstState) return { ok: false, error: 'El proyecto no tiene workflow' };

  const totalTasks = gen.sprints.reduce((n, s) => n + s.tasks.length, 0);
  if (totalTasks === 0) return { ok: false, error: 'El plan no tiene tareas' };

  await prisma.$transaction(async (tx) => {
    const counter = await tx.projectTaskCounter.update({
      where: { projectId: ctx.projectId },
      data: { next: { increment: totalTasks } },
    });
    let nextNumber = counter.next - totalTasks;
    let pos = 0;

    for (const [si, sprint] of gen.sprints.entries()) {
      const createdSprint = await tx.sprint.create({
        data: { projectId: ctx.projectId, name: sprint.name, goal: sprint.goal || null, order: si },
      });
      for (const t of sprint.tasks) {
        const task = await tx.task.create({
          data: {
            projectId: ctx.projectId,
            taskNumber: nextNumber++,
            stateId: firstState.id,
            sprintId: createdSprint.id,
            title: t.title.slice(0, 200),
            description: t.description || null,
            acceptanceCriteria: t.acceptanceCriteria || null,
            estimate: t.estimate || null,
            category: normalizeCategory(t.category),
            recommendedRoles: t.recommendedRoles ?? [],
            priority: normalizePriority(t.priority),
            kind: normalizeKind(t.kind),
            reporterId: ctx.userId,
            positionInState: pos++,
          },
        });
        await tx.taskActivity.create({
          data: { taskId: task.id, actorId: ctx.userId, type: 'CREATED', payload: { via: 'plan' } },
        });
      }
    }

    await tx.projectPlan.update({ where: { id: plan.id }, data: { status: 'PUBLISHED' } });
  });

  revalidatePath(`/projects/${slug}/board`);
  revalidatePath(`/projects/${slug}/roadmap`);
  revalidatePath(`/projects/${slug}/plan`);
  return { ok: true, data: { tasks: totalTasks, sprints: gen.sprints.length } };
}
