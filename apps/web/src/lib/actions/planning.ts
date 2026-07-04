'use server';

import { revalidatePath } from 'next/cache';
import { Prisma, type PlanAttachment } from '@prisma/client';
import { prisma } from '@/lib/db';
import { assertProjectMember } from '@/lib/auth/membership';
import { getServerLang } from '@/lib/i18n/server';
import { parseAgentMention, personaSystem } from '@/lib/agents/mentions';

/** HUs YA publicadas del tablero (título + estado) para que el chat y el
 *  generador iteren SIN repetir. Defensivo: fallo → '' (cero impacto). */
async function boardManifest(projectId: string, cap = 120): Promise<string> {
  try {
    const tasks = await prisma.task.findMany({
      where: { projectId },
      select: { taskNumber: true, title: true, state: { select: { name: true } } },
      orderBy: { taskNumber: 'asc' },
      take: cap,
    });
    if (tasks.length === 0) return '';
    return (
      'HUs ya publicadas en el tablero (contexto — no proponer duplicados):\n' +
      tasks.map((t) => `- #${t.taskNumber} ${t.title} [${t.state.name}]`).join('\n')
    );
  } catch {
    return '';
  }
}
import {
  planChatReply,
  generatePlan,
  refinePlanTask,
  generateImplementationPlan,
  type ChatMsg,
  type Lang,
  type PlanImage,
  type PlanDocText,
  type ImplRepoFile,
  reestimatePlan,
  type ReestimateItemInput,
  estimateTaskForSeniority,
} from '@/lib/ai/planner';
import { isInfraLlmConfigured } from '@/lib/ai/infra-llm';
import { repoReaderFor, type TreeNode } from '@/lib/repo/reader';
import {
  generatedPlanSchema,
  planTaskSchema,
  normalizeCategory,
  normalizeKind,
  normalizePriority,
  normalizeEstimates,
  type GeneratedPlan,
  type PlanTask,
} from '@/lib/ai/plan-schema';
import { fetchUrlText, isImageMime } from '@/lib/ai/extract';
import { getObjectBytes, deleteObject, putObject, buildKey, isStorageConfigured } from '@/lib/storage';
import { publish, planChannel } from '@/lib/realtime';
import { seedBrainFromPlan } from '@/lib/brain/seed-from-plan';
import { HEX_COLOR } from '@/lib/plan-colors';
import type { ActionResult } from './projects';

export interface AttachmentView {
  id: string;
  kind: 'IMAGE' | 'DOCUMENT' | 'LINK';
  name: string;
  mimeType: string | null;
  url: string | null;
}
/** Which graph (if any) grounds the plan. `null` means "auto": use the code
 *  knowledge graph when a READY analysis exists (the historical default). */
export type ContextGraph = 'CODE_GRAPH' | 'NONE';

/** Live generation progress (set while status=GENERATING). */
export interface PlanProgress {
  phase: 'starting' | 'resolving_context' | 'code_context' | 'calling_opus' | 'normalizing';
  startedAt: string; // ISO
}

export interface PlanView {
  id: string;
  status: 'CHATTING' | 'GENERATING' | 'READY' | 'PUBLISHED' | 'FAILED';
  messages: ChatMsg[];
  generated: GeneratedPlan | null;
  improvedIdea: string | null;
  error: string | null;
  attachments: AttachmentView[];
  contextGraph: ContextGraph | null;
  progress: PlanProgress | null;
  heartbeatAt: string | null; // ISO; last progress tick while GENERATING
  chatColors: Record<string, string>; // { [userId]: "#rrggbb" }, shared per project
}

// A GENERATING plan whose heartbeat is older than this is considered orphaned
// (e.g. the server restarted mid-run) and may be safely relaunched.
const PLAN_STALE_MS = 5 * 60 * 1000;

const planInclude = { attachments: { orderBy: { createdAt: 'asc' as const } } };

async function projectMeta(projectId: string) {
  return prisma.project.findUnique({ where: { id: projectId }, select: { name: true, description: true } });
}

/** The code knowledge-graph brief, when a READY analysis exists, so the planner
 *  can plan in brownfield mode (over the real existing code). Undefined → the
 *  planner stays in its original greenfield behavior.
 *
 *  `choice` is the plan's explicit context selection: 'NONE' disconnects the
 *  graph (greenfield even if one exists); 'CODE_GRAPH'/null use the code graph. */
async function codeContext(projectId: string, choice?: ContextGraph | null): Promise<string | undefined> {
  if (choice === 'NONE') return undefined;
  const row = await prisma.codeAnalysis.findUnique({
    where: { projectId },
    select: { status: true, summary: true },
  });
  return row?.status === 'READY' && row.summary ? row.summary : undefined;
}

function toProgress(stats: unknown): PlanProgress | null {
  if (!stats || typeof stats !== 'object') return null;
  const s = stats as Record<string, unknown>;
  if (typeof s.phase !== 'string' || typeof s.startedAt !== 'string') return null;
  return { phase: s.phase as PlanProgress['phase'], startedAt: s.startedAt };
}

function toView(p: {
  id: string;
  status: string;
  messages: unknown;
  generated: unknown;
  improvedIdea: string | null;
  error: string | null;
  contextGraph: string | null;
  stats?: unknown;
  heartbeatAt?: Date | null;
  chatColors?: unknown;
  attachments: PlanAttachment[];
}): PlanView {
  return {
    id: p.id,
    status: p.status as PlanView['status'],
    messages: Array.isArray(p.messages) ? (p.messages as unknown as ChatMsg[]) : [],
    generated: p.generated ? (p.generated as GeneratedPlan) : null,
    improvedIdea: p.improvedIdea,
    error: p.error,
    contextGraph: p.contextGraph === 'NONE' || p.contextGraph === 'CODE_GRAPH' ? p.contextGraph : null,
    progress: p.status === 'GENERATING' ? toProgress(p.stats) : null,
    heartbeatAt: p.heartbeatAt ? p.heartbeatAt.toISOString() : null,
    chatColors:
      p.chatColors && typeof p.chatColors === 'object' ? (p.chatColors as Record<string, string>) : {},
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

/** Manifest of the project files marked as context, so the chat is grounded in
 *  them too (not just in the plan's own attachments). */
async function contextFilesManifest(projectId: string): Promise<string> {
  const files = await prisma.projectFile.findMany({
    where: { projectId, isContext: true },
    orderBy: { createdAt: 'asc' },
    select: { name: true, mimeType: true, category: true, contextStatus: true, contextMarkdown: true },
  });
  if (files.length === 0) return '';
  return files
    .map((f) => {
      if (isImageMime(f.mimeType) || f.category === 'IMAGE') return `- [imagen del proyecto] ${f.name}`;
      const md = f.contextStatus === 'READY' ? (f.contextMarkdown ?? '') : '';
      const excerpt = md.slice(0, 800).replace(/\s+/g, ' ').trim();
      const head = `- [archivo del proyecto] ${f.name}`;
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

/** The assistant's opening greeting for a fresh planning conversation. */
function planOpening(name: string | undefined, lang: Lang): string {
  return lang === 'es'
    ? `¡Hola! Vamos a planear «${name}». Para empezar: ¿cuál es el problema principal que resuelve y para quién? Puedes adjuntar imágenes, documentos o enlaces como contexto, y cuando termines pulsa "Generar plan".`
    : `Hi! Let's plan "${name}". To start: what's the core problem it solves, and for whom? You can attach images, documents or links as context, and hit "Generate plan" when you're done.`;
}

export async function getOrCreatePlanAction(slug: string): Promise<ActionResult<PlanView>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;

  const existing = await loadPlan(ctx.projectId);
  if (existing) return { ok: true, data: toView(existing) };

  const meta = await projectMeta(ctx.projectId);
  const lang = await getServerLang();
  const opening = planOpening(meta?.name, lang);

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
  const author = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
  const userMsg: ChatMsg = {
    role: 'user',
    content: text.slice(0, 4000),
    authorId: ctx.userId,
    authorName: author?.name ?? undefined,
  };
  const withUser: ChatMsg[] = [...history, userMsg];
  const keepStatus = plan.status === 'PUBLISHED' ? 'PUBLISHED' : 'CHATTING';

  // Persist + broadcast the user's message right away so collaborators see it
  // live (and it survives a reload) even before the AI reply lands.
  await prisma.projectPlan.update({
    where: { id: plan.id },
    data: { messages: withUser as unknown as Prisma.InputJsonValue, status: keepStatus },
  });
  await publish(planChannel(plan.id), { type: 'message', message: userMsg });

  const meta = await projectMeta(ctx.projectId);
  const lang = await getServerLang();
  const code = await codeContext(ctx.projectId, plan.contextGraph as ContextGraph | null);
  const manifest = [buildManifest(plan.attachments), await contextFilesManifest(ctx.projectId), await boardManifest(ctx.projectId)]
    .filter(Boolean)
    .join('\n');
  // @mención de un agente → responde EN PERSONA (lente + modelo configurado).
  const mention = parseAgentMention(text);
  let persona: { name: string; system: string; model?: string | null } | undefined;
  let agentLabel: string | undefined;
  if (mention) {
    let displayName: string | null = null;
    let llmModel: string | null = null;
    try {
      const agent = await prisma.agent.findUnique({
        where: { projectId_role: { projectId: ctx.projectId, role: mention.role } },
        select: { displayName: true, llmModel: true },
      });
      displayName = agent?.displayName ?? null;
      llmModel = agent?.llmModel ?? null;
    } catch {
      /* sin agente aprovisionado: persona con defaults */
    }
    const name = displayName?.trim() || mention.name;
    persona = { name, system: personaSystem(mention.role, lang), model: llmModel };
    agentLabel = `${name} · ${mention.role}`;
  }

  let reply: string;
  try {
    reply = await planChatReply(
      { name: meta?.name ?? '', description: meta?.description ?? null },
      withUser,
      lang,
      manifest,
      ctx.userId,
      ctx.projectId,
      code,
      persona,
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error de IA' };
  }

  const assistantMsg: ChatMsg = { role: 'assistant', content: reply, ...(agentLabel ? { agentName: agentLabel } : {}) };
  const next: ChatMsg[] = [...withUser, assistantMsg];
  const updated = await prisma.projectPlan.update({
    where: { id: plan.id },
    data: { messages: next as unknown as Prisma.InputJsonValue, status: keepStatus },
    include: planInclude,
  });
  await publish(planChannel(plan.id), { type: 'message', message: assistantMsg });
  return { ok: true, data: toView(updated) };
}

/** Reset the planning conversation to a fresh greeting (keeps the generated plan,
 *  if any). Lets the team restart the chat after a wrong turn. Broadcasts so
 *  collaborators see the reset live. OWNER/ADMIN/MEMBER (not viewers). */
export async function clearPlanChatAction(slug: string): Promise<ActionResult<PlanView>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };

  const plan = await loadPlan(ctx.projectId);
  if (!plan) return { ok: false, error: 'Plan no encontrado' };

  const meta = await projectMeta(ctx.projectId);
  const lang = await getServerLang();
  const opening = planOpening(meta?.name, lang);
  const messages: ChatMsg[] = [{ role: 'assistant', content: opening }];

  const updated = await prisma.projectPlan.update({
    where: { id: plan.id },
    data: {
      messages: messages as unknown as Prisma.InputJsonValue,
      status: plan.status === 'PUBLISHED' ? 'PUBLISHED' : 'CHATTING',
    },
    include: planInclude,
  });
  await publish(planChannel(plan.id), { type: 'message', message: messages[0]! });
  return { ok: true, data: toView(updated) };
}

/**
 * Set a user's chat bubble color for this project (shared state — anyone can
 * recolor anyone). Persists the map and broadcasts it so all viewers update live.
 */
export async function setChatColorAction(
  slug: string,
  targetUserId: string,
  color: string,
): Promise<ActionResult<Record<string, string>>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (!HEX_COLOR.test(color)) return { ok: false, error: 'Color inválido' };

  const plan = await loadPlan(ctx.projectId);
  if (!plan) return { ok: false, error: 'Plan no encontrado' };

  const current =
    plan.chatColors && typeof plan.chatColors === 'object'
      ? (plan.chatColors as Record<string, string>)
      : {};
  const colors = { ...current, [targetUserId]: color.toLowerCase() };

  await prisma.projectPlan.update({
    where: { id: plan.id },
    data: { chatColors: colors as unknown as Prisma.InputJsonValue },
  });
  await publish(planChannel(plan.id), { type: 'colors', colors });
  return { ok: true, data: colors };
}

/** Broadcast a "typing" ping to other plan viewers (no persistence). */
export async function planTypingAction(slug: string): Promise<ActionResult> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: true }; // viewers don't type
  const plan = await prisma.projectPlan.findFirst({
    where: { projectId: ctx.projectId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!plan) return { ok: true };
  const author = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
  await publish(planChannel(plan.id), {
    type: 'typing',
    userId: ctx.userId,
    name: author?.name ?? '',
  });
  return { ok: true };
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
  normalizeEstimates(gen); // derive each task's "junior–senior" range
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
  // Already running with a fresh heartbeat → no-op (avoid double generation).
  // A stale heartbeat means the previous run was orphaned (e.g. server restart);
  // fall through and relaunch.
  if (plan.status === 'GENERATING') {
    const fresh = plan.heartbeatAt && Date.now() - plan.heartbeatAt.getTime() < PLAN_STALE_MS;
    if (fresh) return { ok: true };
  }

  const messages: ChatMsg[] = Array.isArray(plan.messages) ? (plan.messages as unknown as ChatMsg[]) : [];
  const lang = await getServerLang();
  await prisma.projectPlan.update({
    where: { id: plan.id },
    data: {
      status: 'GENERATING',
      error: null,
      stats: { phase: 'starting', startedAt: new Date().toISOString() } as Prisma.InputJsonValue,
      heartbeatAt: new Date(),
    },
  });

  void runPlanGeneration(plan.id, ctx.projectId, ctx.userId, messages, lang, plan.contextGraph as ContextGraph | null);
  return { ok: true };
}

/** Connect (or disconnect) the plan's grounding graph. The chat and the
 *  generator read this on their next run. */
export async function setPlanContextGraphAction(
  slug: string,
  choice: ContextGraph,
): Promise<ActionResult<PlanView>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };
  if (choice !== 'CODE_GRAPH' && choice !== 'NONE') return { ok: false, error: 'Grafo inválido' };

  const plan = await loadPlan(ctx.projectId);
  if (!plan) return { ok: false, error: 'Plan no encontrado' };

  const updated = await prisma.projectPlan.update({
    where: { id: plan.id },
    data: { contextGraph: choice },
    include: planInclude,
  });
  return { ok: true, data: toView(updated) };
}

const IMG_MEDIA: Record<string, PlanImage['mediaType']> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
};

async function pushImage(images: PlanImage[], storageKey: string | null, mimeType: string | null): Promise<void> {
  if (!storageKey || images.length >= 6) return;
  const media = IMG_MEDIA[(mimeType ?? '').toLowerCase()];
  if (!media) return;
  try {
    const bytes = await getObjectBytes(storageKey);
    if (bytes.byteLength > 4 * 1024 * 1024) return; // skip very large images
    images.push({ mediaType: media, base64: Buffer.from(bytes).toString('base64') });
  } catch {
    /* skip unreadable image */
  }
}

/** Gather the model inputs for generation: the plan's own attachments plus the
 *  project files marked as context. Images become vision blocks; documents
 *  contribute extracted text. A single shared budget bounds the whole prompt. */
async function resolveAttachments(
  planId: string,
  projectId: string,
): Promise<{ images: PlanImage[]; docs: PlanDocText[] }> {
  const [atts, ctxFiles] = await Promise.all([
    prisma.planAttachment.findMany({ where: { planId }, orderBy: { createdAt: 'asc' } }),
    prisma.projectFile.findMany({
      where: { projectId, isContext: true },
      orderBy: { createdAt: 'asc' },
      select: { name: true, mimeType: true, category: true, storageKey: true, contextStatus: true, contextMarkdown: true },
    }),
  ]);
  const images: PlanImage[] = [];
  const docs: PlanDocText[] = [];
  let docBudget = 120_000;

  for (const a of atts) {
    if (a.kind === 'IMAGE') {
      await pushImage(images, a.storageKey, a.mimeType);
    } else if ((a.kind === 'DOCUMENT' || a.kind === 'LINK') && a.extractedText && docBudget > 0) {
      const text = a.extractedText.slice(0, docBudget);
      docBudget -= text.length;
      docs.push({ label: a.kind === 'LINK' ? `${a.name} (${a.url})` : a.name, text });
    }
  }

  // Project files marked as context (shared budget, same image cap). Documents
  // contribute their generated Markdown artifact (READY); images go as vision.
  for (const f of ctxFiles) {
    const isImage = isImageMime(f.mimeType) || f.category === 'IMAGE';
    if (isImage) {
      await pushImage(images, f.storageKey, f.mimeType);
    } else if (f.contextStatus === 'READY' && f.contextMarkdown && docBudget > 0) {
      const text = f.contextMarkdown.slice(0, docBudget);
      docBudget -= text.length;
      docs.push({ label: `${f.name} (archivo del proyecto)`, text });
    }
  }
  return { images, docs };
}

/** Advance the visible generation phase + refresh the heartbeat (best-effort;
 *  a progress write must never break generation). `startedAt` is preserved so
 *  the UI can keep a stable elapsed timer across phases. */
async function bumpPlanPhase(planId: string, phase: PlanProgress['phase'], startedAt: string): Promise<void> {
  await prisma.projectPlan
    .update({
      where: { id: planId },
      data: {
        stats: { phase, startedAt } as Prisma.InputJsonValue,
        heartbeatAt: new Date(),
      },
    })
    .catch(() => {});
}

async function runPlanGeneration(
  planId: string,
  projectId: string,
  userId: string,
  messages: ChatMsg[],
  lang: Lang,
  contextGraph: ContextGraph | null,
): Promise<void> {
  const startedAt = new Date().toISOString();
  try {
    await bumpPlanPhase(planId, 'resolving_context', startedAt);
    const meta = await projectMeta(projectId);
    const { images, docs } = await resolveAttachments(planId, projectId);
    await bumpPlanPhase(planId, 'code_context', startedAt);
    const code = await codeContext(projectId, contextGraph);
    await bumpPlanPhase(planId, 'calling_opus', startedAt);
    const existingStories = await boardManifest(projectId);
    const plan = await generatePlan(
      { name: meta?.name ?? '', description: meta?.description ?? null },
      messages,
      lang,
      images,
      docs,
      userId,
      projectId,
      code,
      existingStories || undefined,
    );
    await bumpPlanPhase(planId, 'normalizing', startedAt);
    normalizeEstimates(plan); // derive "junior–senior" range per HU

    await prisma.projectPlan.update({
      where: { id: planId },
      data: {
        status: 'READY',
        generated: plan as unknown as Prisma.InputJsonValue,
        improvedIdea: plan.improvedIdea || null,
        suggestedRepos: plan.suggestedRepos as unknown as Prisma.InputJsonValue,
        error: null,
        stats: Prisma.JsonNull,
        heartbeatAt: new Date(),
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[planning] generation failed:', err);
    await prisma.projectPlan
      .update({
        where: { id: planId },
        data: {
          status: 'FAILED',
          error: err instanceof Error ? err.message : 'Error generando el plan',
          stats: Prisma.JsonNull,
          heartbeatAt: new Date(),
        },
      })
      .catch(() => {});
  }
}

// ---- Generate a repo-grounded implementation plan for a single HU ----

function outlineTree(nodes: TreeNode[], depth = 0, acc: string[] = []): string[] {
  for (const n of nodes) {
    acc.push(`${'  '.repeat(depth)}${n.kind === 'dir' ? '📁' : '·'} ${n.name}`);
    if (n.children?.length) outlineTree(n.children, depth + 1, acc);
  }
  return acc;
}
function flattenFiles(nodes: TreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    if (n.kind === 'file') acc.push(n.path);
    else if (n.children) flattenFiles(n.children, acc);
  }
  return acc;
}
const KW_STOP = new Set([
  'para', 'con', 'los', 'las', 'una', 'unos', 'unas', 'del', 'que', 'por', 'como', 'sobre', 'desde',
  'hacia', 'este', 'esta', 'esto', 'cada', 'todo', 'todos', 'debe', 'poder', 'permitir', 'sistema',
  'aplicacion', 'aplicación', 'usuario', 'usuarios', 'pagina', 'página', 'datos', 'this', 'that',
  'with', 'from', 'your', 'user', 'users', 'story', 'feature', 'should', 'able', 'into', 'when',
]);
function keywordsFrom(task: PlanTask): string[] {
  const text = `${task.title} ${task.description} ${task.category}`.toLowerCase();
  const words = text.match(/[a-z0-9áéíóúñ]{4,}/gi) ?? [];
  const freq = new Map<string, number>();
  for (const w of words) {
    const k = w.toLowerCase();
    if (!KW_STOP.has(k)) freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map((e) => e[0]);
}
function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'hu'
  );
}

/** Recompute per-seniority AI-assisted estimates for every HU in the plan (Opus, one pass). */
export async function reestimatePlanAction(slug: string): Promise<ActionResult<PlanView>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };

  const plan = await loadPlan(ctx.projectId);
  if (!plan) return { ok: false, error: 'Plan no encontrado' };
  const parsed = generatedPlanSchema.safeParse(plan.generated);
  if (!parsed.success) return { ok: false, error: 'No hay un plan generado' };
  const gen = parsed.data;

  const items: ReestimateItemInput[] = [];
  gen.sprints.forEach((sp, s) =>
    sp.tasks.forEach((tk, t) =>
      items.push({ s, t, title: tk.title, description: tk.description, category: tk.category, repo: tk.repo }),
    ),
  );
  if (items.length === 0) return { ok: false, error: 'El plan no tiene HUs' };

  const meta = await projectMeta(ctx.projectId);
  const stack = gen.suggestedRepos
    .map((r) => `${r.name} (${r.kind}${r.stack ? ': ' + r.stack : ''})`)
    .join('; ');
  const lang = await getServerLang();

  let resultItems;
  try {
    resultItems = await reestimatePlan(
      { projectName: meta?.name ?? '', description: meta?.description ?? null, improvedIdea: gen.improvedIdea, stack },
      items,
      lang,
      ctx.userId,
      ctx.projectId,
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error de IA' };
  }

  for (const it of resultItems) {
    const tk = gen.sprints[it.s]?.tasks[it.t];
    if (!tk) continue;
    tk.estimateBySeniority = it.estimateBySeniority;
    if (it.estimate) tk.estimate = it.estimate;
  }
  // saveGenerated normalizes the "junior–senior" range and persists.
  return { ok: true, data: await saveGenerated(ctx.projectId, plan.id, gen) };
}

// ---- Assign a member to a HU and recompute the time for their seniority (Qwen) ----

const SENIORITY_KEY: Record<string, 'junior' | 'semiSenior' | 'senior'> = {
  JUNIOR: 'junior',
  SEMI_SENIOR: 'semiSenior',
  SENIOR: 'senior',
};

export async function getProjectMembersForAssignAction(
  slug: string,
): Promise<ActionResult<{ members: { userId: string; name: string; seniority: string | null }[] }>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  const rows = await prisma.projectMember.findMany({
    where: { projectId: ctx.projectId },
    select: { userId: true, seniority: true, user: { select: { name: true } } },
    orderBy: { joinedAt: 'asc' },
  });
  return {
    ok: true,
    data: { members: rows.map((m) => ({ userId: m.userId, name: m.user.name, seniority: m.seniority })) },
  };
}

export async function assignTaskMemberAction(
  slug: string,
  sprintIndex: number,
  taskIndex: number,
  memberId: string,
): Promise<ActionResult<PlanView>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };

  const plan = await loadPlan(ctx.projectId);
  if (!plan) return { ok: false, error: 'Plan no encontrado' };
  const parsed = generatedPlanSchema.safeParse(plan.generated);
  if (!parsed.success) return { ok: false, error: 'No hay un plan generado' };
  const gen = parsed.data;
  if (!inBounds(gen, sprintIndex, taskIndex)) return { ok: false, error: 'HU no encontrada' };
  const tk = gen.sprints[sprintIndex]!.tasks[taskIndex]!;

  const member = await prisma.projectMember.findFirst({
    where: { projectId: ctx.projectId, userId: memberId },
    select: { userId: true, seniority: true, user: { select: { name: true } } },
  });
  if (!member) return { ok: false, error: 'Miembro no encontrado' };

  const seniority = member.seniority ?? 'SEMI_SENIOR';
  const fallback = (tk.estimateBySeniority?.[SENIORITY_KEY[seniority]!] ?? '').trim();

  let estimate = fallback;
  if (isInfraLlmConfigured()) {
    const stack = gen.suggestedRepos
      .map((r) => `${r.name} (${r.kind}${r.stack ? ': ' + r.stack : ''})`)
      .join('; ');
    const lang = await getServerLang();
    try {
      estimate =
        (await estimateTaskForSeniority(
          { title: tk.title, description: tk.description, category: tk.category, repo: tk.repo },
          { stack, improvedIdea: gen.improvedIdea },
          seniority,
          lang,
        )) || fallback;
    } catch {
      estimate = fallback;
    }
  }
  if (!estimate) estimate = tk.estimate;

  tk.assignment = { memberId: member.userId, memberName: member.user.name, seniority, estimate };
  return { ok: true, data: await saveGenerated(ctx.projectId, plan.id, gen) };
}

export async function clearTaskAssignmentAction(
  slug: string,
  sprintIndex: number,
  taskIndex: number,
): Promise<ActionResult<PlanView>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };
  const plan = await loadPlan(ctx.projectId);
  if (!plan) return { ok: false, error: 'Plan no encontrado' };
  const parsed = generatedPlanSchema.safeParse(plan.generated);
  if (!parsed.success) return { ok: false, error: 'No hay un plan generado' };
  const gen = parsed.data;
  if (!inBounds(gen, sprintIndex, taskIndex)) return { ok: false, error: 'HU no encontrada' };
  gen.sprints[sprintIndex]!.tasks[taskIndex]!.assignment = null;
  return { ok: true, data: await saveGenerated(ctx.projectId, plan.id, gen) };
}

export async function generateImplPlanAction(
  slug: string,
  sprintIndex: number,
  taskIndex: number,
  repoId?: string,
): Promise<ActionResult<{ filename: string; markdown: string; fileId: string | null }>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos' };

  const plan = await loadPlan(ctx.projectId);
  if (!plan) return { ok: false, error: 'Plan no encontrado' };
  const parsed = generatedPlanSchema.safeParse(plan.generated);
  if (!parsed.success) return { ok: false, error: 'No hay un plan generado' };
  const gen = parsed.data;
  if (!inBounds(gen, sprintIndex, taskIndex)) return { ok: false, error: 'HU no encontrada' };
  const sprint = gen.sprints[sprintIndex]!;
  const task = sprint.tasks[taskIndex]!;

  const project = await prisma.project.findUnique({
    where: { id: ctx.projectId },
    select: { name: true, description: true, repoPath: true },
  });

  // Resolve the repo to read for THIS story: explicit selection › the HU's
  // assigned repo › a repo whose kind matches the HU category › legacy single repo.
  const projectRepos = await prisma.projectRepo.findMany({ where: { projectId: ctx.projectId } });
  let chosen = repoId ? projectRepos.find((r) => r.id === repoId) : undefined;
  if (!chosen && task.repo)
    chosen = projectRepos.find((r) => r.name.toLowerCase() === task.repo.toLowerCase());
  if (!chosen && task.category)
    chosen = projectRepos.find((r) => r.kind.toLowerCase() === task.category.toLowerCase());
  const repoPath = chosen?.repoPath ?? project?.repoPath ?? null;

  // The repo is optional: brownfield → ground the plan in the existing code;
  // greenfield (no repo/local path) → still produce a plan from the HU + context.
  const reader = repoPath ? await repoReaderFor({ repoPath }) : null;

  // Outline + automatic relevant-file selection (only when a repo is readable).
  let outline = '';
  let repoFiles: ImplRepoFile[] = [];
  if (reader) {
    let tree: TreeNode[] = [];
    try {
      tree = await reader.tree({ maxDepth: 3 });
    } catch {
      /* repo unreadable — outline stays empty */
    }
    outline = outlineTree(tree).slice(0, 400).join('\n');
    const allFiles = flattenFiles(tree);

    const kws = keywordsFrom(task);
    const candidates = new Set<string>();
    for (const kw of kws.slice(0, 6)) {
      if (candidates.size >= 30) break;
      try {
        const hits = await reader.grep(kw);
        for (const h of hits) {
          candidates.add(h.path);
          if (candidates.size >= 30) break;
        }
      } catch {
        /* skip this keyword */
      }
    }
    for (const p of allFiles) {
      if (candidates.size >= 30) break;
      if (kws.some((k) => p.toLowerCase().includes(k))) candidates.add(p);
    }
    if (candidates.size < 5) for (const p of allFiles.slice(0, 20)) candidates.add(p);

    try {
      const { files } = await reader.readFiles([...candidates].slice(0, 25), {
        maxFiles: 25,
        maxBytesTotal: 140_000,
        maxPerFile: 20_000,
      });
      repoFiles = files.map((f) => ({ path: f.path, content: f.content, language: f.language, truncated: f.truncated }));
    } catch {
      /* proceed with outline only */
    }
  }

  const lang = await getServerLang();
  let markdown: string;
  try {
    markdown = await generateImplementationPlan(
      { name: project?.name ?? '', description: project?.description ?? null },
      task,
      { name: sprint.name, goal: sprint.goal },
      gen.improvedIdea,
      outline,
      repoFiles,
      lang,
      ctx.userId,
      ctx.projectId,
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error de IA' };
  }

  const repoTag = chosen ? `${slugify(chosen.name)}-` : '';
  const filename = `IMPL-${slug}-${repoTag}S${sprintIndex + 1}T${taskIndex + 1}-${slugify(task.title)}.md`.slice(0, 120);

  // Persist to the project Files store (best-effort).
  let fileId: string | null = null;
  if (isStorageConfigured()) {
    try {
      const id = crypto.randomUUID();
      const buf = Buffer.from(markdown, 'utf8');
      const key = buildKey(slug, 'DOCUMENT', id, filename, new Date());
      await putObject(key, buf, 'text/markdown');
      await prisma.projectFile.create({
        data: {
          id,
          projectId: ctx.projectId,
          name: filename,
          mimeType: 'text/markdown',
          size: buf.byteLength,
          category: 'DOCUMENT',
          storageKey: key,
          uploadedById: ctx.userId,
        },
      });
      fileId = id;
    } catch {
      fileId = null; // download still works even if persistence fails
    }
  }

  return { ok: true, data: { filename, markdown, fileId } };
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

  // Iteración sin duplicados: las HUs cuyo título ya existe en el tablero se
  // saltan, y los sprints se REUSAN por nombre (publicar de nuevo no clona).
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  let existingTitles = new Set<string>();
  let existingSprints = new Map<string, string>();
  let sprintCount = 0;
  try {
    const [curTasks, curSprints] = await Promise.all([
      prisma.task.findMany({ where: { projectId: ctx.projectId }, select: { title: true } }),
      prisma.sprint.findMany({ where: { projectId: ctx.projectId }, select: { id: true, name: true } }),
    ]);
    existingTitles = new Set(curTasks.map((t) => norm(t.title)));
    existingSprints = new Map(curSprints.map((s) => [norm(s.name), s.id]));
    sprintCount = curSprints.length;
  } catch {
    /* primer publish / tests: sin dedupe */
  }
  const sprintsToCreate = gen.sprints
    .map((s) => ({ ...s, tasks: s.tasks.filter((t) => !existingTitles.has(norm(t.title))) }))
    .filter((s) => s.tasks.length > 0);
  const skipped = gen.sprints.reduce((n, s) => n + s.tasks.length, 0) -
    sprintsToCreate.reduce((n, s) => n + s.tasks.length, 0);

  const totalTasks = sprintsToCreate.reduce((n, s) => n + s.tasks.length, 0);
  if (totalTasks === 0) {
    return { ok: false, error: skipped > 0 ? 'Todas las HUs del plan ya existen en el tablero (0 nuevas)' : 'El plan no tiene tareas' };
  }

  await prisma.$transaction(async (tx) => {
    const counter = await tx.projectTaskCounter.update({
      where: { projectId: ctx.projectId },
      data: { next: { increment: totalTasks } },
    });
    let nextNumber = counter.next - totalTasks;
    let pos = 0;

    for (const [si, sprint] of sprintsToCreate.entries()) {
      const reusedId = existingSprints.get(norm(sprint.name));
      const createdSprint = reusedId
        ? { id: reusedId }
        : await tx.sprint.create({
            data: { projectId: ctx.projectId, name: sprint.name, goal: sprint.goal || null, order: sprintCount + si },
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
            estimateBySeniority: t.estimateBySeniority as unknown as Prisma.InputJsonValue,
            assigneeId: t.assignment?.memberId || null,
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

  // Auto-seed the project brain from the plan so an external coding agent (Fusion
  // Code / Qwen) has the plan's context via `recall` from the start. Best-effort:
  // a brain hiccup must not fail the publish.
  await seedBrainFromPlan({ projectId: ctx.projectId, authorId: ctx.userId, plan: gen }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[planning] seedBrainFromPlan failed:', err);
  });

  revalidatePath(`/projects/${slug}/board`);
  revalidatePath(`/projects/${slug}/roadmap`);
  revalidatePath(`/projects/${slug}/plan`);
  revalidatePath(`/projects/${slug}/brain`);
  return { ok: true, data: { tasks: totalTasks, sprints: gen.sprints.length } };
}
