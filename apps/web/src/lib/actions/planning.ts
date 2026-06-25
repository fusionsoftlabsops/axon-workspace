'use server';

import { revalidatePath } from 'next/cache';
import { Prisma, type PlanAttachment } from '@prisma/client';
import { prisma } from '@/lib/db';
import { assertProjectMember } from '@/lib/auth/membership';
import { getServerLang } from '@/lib/i18n/server';
import {
  planChatReply,
  generatePlan,
  refinePlanTask,
  type ChatMsg,
  type Lang,
  type PlanImage,
  type PlanDocText,
} from '@/lib/ai/planner';
import {
  generatedPlanSchema,
  planTaskSchema,
  normalizeCategory,
  normalizeKind,
  normalizePriority,
  type GeneratedPlan,
  type PlanTask,
} from '@/lib/ai/plan-schema';
import { fetchUrlText } from '@/lib/ai/extract';
import { getObjectBytes, deleteObject } from '@/lib/storage';
import type { ActionResult } from './projects';

export interface AttachmentView {
  id: string;
  kind: 'IMAGE' | 'DOCUMENT' | 'LINK';
  name: string;
  mimeType: string | null;
  url: string | null;
}
export interface PlanView {
  id: string;
  status: 'CHATTING' | 'GENERATING' | 'READY' | 'PUBLISHED' | 'FAILED';
  messages: ChatMsg[];
  generated: GeneratedPlan | null;
  improvedIdea: string | null;
  error: string | null;
  attachments: AttachmentView[];
}

const planInclude = { attachments: { orderBy: { createdAt: 'asc' as const } } };

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
  attachments: PlanAttachment[];
}): PlanView {
  return {
    id: p.id,
    status: p.status as PlanView['status'],
    messages: Array.isArray(p.messages) ? (p.messages as unknown as ChatMsg[]) : [],
    generated: p.generated ? (p.generated as GeneratedPlan) : null,
    improvedIdea: p.improvedIdea,
    error: p.error,
    attachments: p.attachments.map((a) => ({
      id: a.id,
      kind: a.kind,
      name: a.name,
      mimeType: a.mimeType,
      url: a.url,
    })),
  };
}

/** Short manifest of attachments fed to the chat model so it can ask informed questions. */
function buildManifest(atts: PlanAttachment[]): string {
  if (atts.length === 0) return '';
  return atts
    .map((a) => {
      if (a.kind === 'IMAGE') return `- [imagen] ${a.name}`;
      const excerpt = (a.extractedText ?? '').slice(0, 800).replace(/\s+/g, ' ').trim();
      const head = a.kind === 'LINK' ? `- [enlace] ${a.name} (${a.url})` : `- [doc] ${a.name}`;
      return excerpt ? `${head}: ${excerpt}` : head;
    })
    .join('\n');
}

async function loadPlan(projectId: string) {
  return prisma.projectPlan.findFirst({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    include: planInclude,
  });
}

export async function getOrCreatePlanAction(slug: string): Promise<ActionResult<PlanView>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;

  const existing = await loadPlan(ctx.projectId);
  if (existing) return { ok: true, data: toView(existing) };

  const meta = await projectMeta(ctx.projectId);
  const lang = await getServerLang();
  const opening =
    lang === 'es'
      ? `¡Hola! Vamos a planear «${meta?.name}». Para empezar: ¿cuál es el problema principal que resuelve y para quién? Puedes adjuntar imágenes, documentos o enlaces como contexto, y cuando termines pulsa "Generar plan".`
      : `Hi! Let's plan "${meta?.name}". To start: what's the core problem it solves, and for whom? You can attach images, documents or links as context, and hit "Generate plan" when you're done.`;

  const created = await prisma.projectPlan.create({
    data: {
      projectId: ctx.projectId,
      createdById: ctx.userId,
      status: 'CHATTING',
      messages: [{ role: 'assistant', content: opening }] as unknown as Prisma.InputJsonValue,
    },
    include: planInclude,
  });
  return { ok: true, data: toView(created) };
}

export async function planChatAction(slug: string, userMessage: string): Promise<ActionResult<PlanView>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };
  const text = userMessage.trim();
  if (!text) return { ok: false, error: 'Mensaje vacío' };

  const plan = await loadPlan(ctx.projectId);
  if (!plan) return { ok: false, error: 'Plan no encontrado' };
  if (plan.status === 'GENERATING') return { ok: false, error: 'Generando el plan…' };

  const history: ChatMsg[] = Array.isArray(plan.messages) ? (plan.messages as unknown as ChatMsg[]) : [];
  const withUser: ChatMsg[] = [...history, { role: 'user', content: text.slice(0, 4000) }];

  const meta = await projectMeta(ctx.projectId);
  const lang = await getServerLang();
  let reply: string;
  try {
    reply = await planChatReply(
      { name: meta?.name ?? '', description: meta?.description ?? null },
      withUser,
      lang,
      buildManifest(plan.attachments),
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
    include: planInclude,
  });
  return { ok: true, data: toView(updated) };
}

export async function addPlanLinkAction(slug: string, rawUrl: string): Promise<ActionResult<PlanView>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };

  let url: string;
  try {
    const u = new URL(rawUrl.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('proto');
    url = u.toString();
  } catch {
    return { ok: false, error: 'URL inválida' };
  }

  const plan = await loadPlan(ctx.projectId);
  if (!plan) return { ok: false, error: 'Plan no encontrado' };

  let title = url;
  let textContent = '';
  try {
    const fetched = await fetchUrlText(url);
    title = fetched.title || url;
    textContent = fetched.text;
  } catch {
    return { ok: false, error: 'No se pudo leer el enlace' };
  }

  await prisma.planAttachment.create({
    data: { planId: plan.id, kind: 'LINK', name: title, url, extractedText: textContent || null },
  });
  const updated = await loadPlan(ctx.projectId);
  return { ok: true, data: toView(updated!) };
}

export async function removePlanAttachmentAction(slug: string, attId: string): Promise<ActionResult<PlanView>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };

  const plan = await loadPlan(ctx.projectId);
  if (!plan) return { ok: false, error: 'Plan no encontrado' };
  const att = plan.attachments.find((a) => a.id === attId);
  if (!att) return { ok: false, error: 'Adjunto no encontrado' };

  await prisma.planAttachment.delete({ where: { id: att.id } });
  if (att.storageKey) await deleteObject(att.storageKey).catch(() => {});
  const updated = await loadPlan(ctx.projectId);
  return { ok: true, data: toView(updated!) };
}

// ---- Refine / edit a single HU (task) within the generated plan, pre-publish ----

type EditableLoad =
  | { ok: true; projectId: string; userId: string; planId: string; gen: GeneratedPlan }
  | { ok: false; error: string };

/** Load the latest plan, ensure the caller can edit it and it's in READY state,
 *  and return its parsed (typed) generated content. */
async function loadEditablePlan(slug: string): Promise<EditableLoad> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };
  const plan = await loadPlan(ctx.projectId);
  if (!plan) return { ok: false, error: 'Plan no encontrado' };
  if (plan.status !== 'READY') return { ok: false, error: 'El plan no es editable en este estado' };
  const parsed = generatedPlanSchema.safeParse(plan.generated);
  if (!parsed.success) return { ok: false, error: 'Plan inválido' };
  return { ok: true, projectId: ctx.projectId, userId: ctx.userId, planId: plan.id, gen: parsed.data };
}

/** Persist a mutated generated plan and return the refreshed PlanView. */
async function saveGenerated(projectId: string, planId: string, gen: GeneratedPlan): Promise<PlanView> {
  await prisma.projectPlan.update({
    where: { id: planId },
    data: {
      generated: gen as unknown as Prisma.InputJsonValue,
      improvedIdea: gen.improvedIdea || null,
      suggestedRepos: gen.suggestedRepos as unknown as Prisma.InputJsonValue,
    },
  });
  const updated = await loadPlan(projectId);
  return toView(updated!);
}

function inBounds(gen: GeneratedPlan, si: number, ti?: number): boolean {
  if (!Number.isInteger(si) || si < 0 || si >= gen.sprints.length) return false;
  if (ti === undefined) return true;
  const tasks = gen.sprints[si]!.tasks;
  return Number.isInteger(ti) && ti >= 0 && ti < tasks.length;
}

export async function refinePlanTaskAction(
  slug: string,
  sprintIndex: number,
  taskIndex: number,
  focusNote: string,
): Promise<ActionResult<PlanView>> {
  const loaded = await loadEditablePlan(slug);
  if (!loaded.ok) return loaded;
  const { gen, projectId, userId, planId } = loaded;
  if (!inBounds(gen, sprintIndex, taskIndex)) return { ok: false, error: 'HU no encontrada' };

  const sprint = gen.sprints[sprintIndex]!;
  const task = sprint.tasks[taskIndex]!;
  const meta = await projectMeta(projectId);
  const lang = await getServerLang();

  let refined: PlanTask;
  try {
    refined = await refinePlanTask(
      { name: meta?.name ?? '', description: meta?.description ?? null },
      gen.improvedIdea,
      {
        name: sprint.name,
        goal: sprint.goal,
        siblingTitles: sprint.tasks.filter((_, i) => i !== taskIndex).map((t) => t.title),
      },
      task,
      (focusNote ?? '').slice(0, 2000),
      lang,
      userId,
      projectId,
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error de IA' };
  }

  sprint.tasks[taskIndex] = refined;
  return { ok: true, data: await saveGenerated(projectId, planId, gen) };
}

export async function updatePlanTaskAction(
  slug: string,
  sprintIndex: number,
  taskIndex: number,
  patch: Partial<PlanTask>,
): Promise<ActionResult<PlanView>> {
  const loaded = await loadEditablePlan(slug);
  if (!loaded.ok) return loaded;
  const { gen, projectId, planId } = loaded;
  if (!inBounds(gen, sprintIndex, taskIndex)) return { ok: false, error: 'HU no encontrada' };

  const parsed = planTaskSchema.partial().safeParse(patch);
  if (!parsed.success) return { ok: false, error: 'Datos inválidos' };

  const current = gen.sprints[sprintIndex]!.tasks[taskIndex]!;
  const merged = planTaskSchema.safeParse({ ...current, ...parsed.data });
  if (!merged.success) return { ok: false, error: 'Datos inválidos' };
  gen.sprints[sprintIndex]!.tasks[taskIndex] = merged.data;
  return { ok: true, data: await saveGenerated(projectId, planId, gen) };
}

export async function removePlanTaskAction(
  slug: string,
  sprintIndex: number,
  taskIndex: number,
): Promise<ActionResult<PlanView>> {
  const loaded = await loadEditablePlan(slug);
  if (!loaded.ok) return loaded;
  const { gen, projectId, planId } = loaded;
  if (!inBounds(gen, sprintIndex, taskIndex)) return { ok: false, error: 'HU no encontrada' };

  gen.sprints[sprintIndex]!.tasks.splice(taskIndex, 1);
  // Drop the sprint if it has no tasks left.
  if (gen.sprints[sprintIndex]!.tasks.length === 0) gen.sprints.splice(sprintIndex, 1);
  return { ok: true, data: await saveGenerated(projectId, planId, gen) };
}

export async function updatePlanSprintAction(
  slug: string,
  sprintIndex: number,
  patch: { name?: string; goal?: string },
): Promise<ActionResult<PlanView>> {
  const loaded = await loadEditablePlan(slug);
  if (!loaded.ok) return loaded;
  const { gen, projectId, planId } = loaded;
  if (!inBounds(gen, sprintIndex)) return { ok: false, error: 'Sprint no encontrado' };

  const sprint = gen.sprints[sprintIndex]!;
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return { ok: false, error: 'El nombre del sprint no puede estar vacío' };
    sprint.name = name.slice(0, 120);
  }
  if (patch.goal !== undefined) sprint.goal = patch.goal.slice(0, 2000);
  return { ok: true, data: await saveGenerated(projectId, planId, gen) };
}

export async function startPlanGenerationAction(slug: string): Promise<ActionResult> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };

  const plan = await loadPlan(ctx.projectId);
  if (!plan) return { ok: false, error: 'Plan no encontrado' };
  if (plan.status === 'GENERATING') return { ok: true };

  const messages: ChatMsg[] = Array.isArray(plan.messages) ? (plan.messages as unknown as ChatMsg[]) : [];
  const lang = await getServerLang();
  await prisma.projectPlan.update({ where: { id: plan.id }, data: { status: 'GENERATING', error: null } });

  void runPlanGeneration(plan.id, ctx.projectId, ctx.userId, messages, lang);
  return { ok: true };
}

const IMG_MEDIA: Record<string, PlanImage['mediaType']> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
};

async function resolveAttachments(planId: string): Promise<{ images: PlanImage[]; docs: PlanDocText[] }> {
  const atts = await prisma.planAttachment.findMany({ where: { planId }, orderBy: { createdAt: 'asc' } });
  const images: PlanImage[] = [];
  const docs: PlanDocText[] = [];
  let docBudget = 120_000;

  for (const a of atts) {
    if (a.kind === 'IMAGE' && a.storageKey && images.length < 6) {
      const media = IMG_MEDIA[(a.mimeType ?? '').toLowerCase()];
      if (!media) continue;
      try {
        const bytes = await getObjectBytes(a.storageKey);
        if (bytes.byteLength > 4 * 1024 * 1024) continue; // skip very large images
        images.push({ mediaType: media, base64: Buffer.from(bytes).toString('base64') });
      } catch {
        /* skip unreadable image */
      }
    } else if ((a.kind === 'DOCUMENT' || a.kind === 'LINK') && a.extractedText && docBudget > 0) {
      const text = a.extractedText.slice(0, docBudget);
      docBudget -= text.length;
      docs.push({ label: a.kind === 'LINK' ? `${a.name} (${a.url})` : a.name, text });
    }
  }
  return { images, docs };
}

async function runPlanGeneration(
  planId: string,
  projectId: string,
  userId: string,
  messages: ChatMsg[],
  lang: Lang,
): Promise<void> {
  try {
    const meta = await projectMeta(projectId);
    const { images, docs } = await resolveAttachments(planId);
    const plan = await generatePlan(
      { name: meta?.name ?? '', description: meta?.description ?? null },
      messages,
      lang,
      images,
      docs,
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

export async function publishPlanAction(slug: string): Promise<ActionResult<{ tasks: number; sprints: number }>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };

  const plan = await loadPlan(ctx.projectId);
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
