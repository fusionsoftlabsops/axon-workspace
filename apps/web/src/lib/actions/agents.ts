'use server';

import { revalidatePath } from 'next/cache';
import type { AgentRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { assertProjectMember } from '@/lib/auth/membership';
import { provisionAgent } from '@/lib/agents/provision';
import { agentDisplayName, DEFAULT_AGENT_NAMES } from '@/lib/agents/team-chat';
import { ROLES, DEFAULT_ROLE_MODEL } from '@/lib/agents/roles';
import type { ActionResult } from './projects';

export interface AgentView {
  id: string;
  role: AgentRole;
  /** Nombre propio editable (ej. "Nova"), sin el sufijo de rol. */
  name: string;
  /** "{name} · {ROL}", listo para encabezados/chat. */
  displayName: string;
  llmModel: string;
  credentialRef: string | null;
  tokenBudget: number;
  enabled: boolean;
  tokenPrefix: string | null;
  createdAt: string;
}

// ROLES y AXON_DEFAULT_MODEL provienen ahora de la fuente única (import arriba).

async function guard(slug: string) {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role !== 'OWNER' && ctx.role !== 'ADMIN') {
    return { ok: false as const, error: 'Solo OWNER/ADMIN pueden gestionar agentes' };
  }
  return ctx;
}

async function loadAgents(projectId: string): Promise<AgentView[]> {
  const rows = await prisma.agent.findMany({
    where: { projectId },
    include: { apiToken: { select: { prefix: true } } },
    orderBy: { role: 'asc' },
  });
  return rows.map((a) => ({
    id: a.id,
    role: a.role,
    name: a.displayName?.trim() || DEFAULT_AGENT_NAMES[a.role],
    displayName: agentDisplayName(a.role, a.displayName),
    llmModel: a.llmModel,
    credentialRef: a.credentialRef,
    tokenBudget: a.tokenBudget,
    enabled: a.enabled,
    tokenPrefix: a.apiToken?.prefix ?? null,
    createdAt: a.createdAt.toISOString(),
  }));
}

/** Agentes del proyecto (para la UI de administración). */
export async function listAgentsAction(slug: string): Promise<ActionResult<AgentView[]>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  return { ok: true, data: await loadAgents(ctx.projectId) };
}

/**
 * Crea la identidad completa de un agente (usuario de servicio + membresía +
 * token + fila Agent). Devuelve el token plano UNA sola vez.
 */
export async function provisionAgentAction(
  slug: string,
  input: { role: AgentRole; llmModel: string; credentialRef?: string | null; tokenBudget?: number },
): Promise<ActionResult<{ agents: AgentView[]; tokenPlain: string }>> {
  const ctx = await guard(slug);
  if (!ctx.ok) return ctx;
  if (!ROLES.includes(input.role)) return { ok: false, error: 'Rol de agente inválido' };
  const llmModel = input.llmModel.trim();
  if (!llmModel) return { ok: false, error: 'llmModel requerido' };
  if (input.tokenBudget !== undefined && (!Number.isInteger(input.tokenBudget) || input.tokenBudget < 1000)) {
    return { ok: false, error: 'tokenBudget inválido (mínimo 1000 tokens)' };
  }

  try {
    const provisioned = await provisionAgent({
      projectId: ctx.projectId,
      projectSlug: slug,
      role: input.role,
      llmModel,
      credentialRef: input.credentialRef ?? null,
      tokenBudget: input.tokenBudget,
    });
    await audit({
      actorId: ctx.userId,
      action: 'agent.provision',
      resourceType: 'agent',
      resourceId: provisioned.agentId,
      projectId: ctx.projectId,
      payload: { role: input.role, llmModel, tokenPrefix: provisioned.tokenPrefix },
    });
    revalidatePath(`/projects/${slug}/agents`);
    return { ok: true, data: { agents: await loadAgents(ctx.projectId), tokenPlain: provisioned.tokenPlain } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudo aprovisionar el agente' };
  }
}

export interface AgentRunView {
  id: string;
  role: AgentRole;
  storyNumber: number | null;
  storyTitle: string | null;
  status: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** Bitácora reciente de corridas de agentes (tokens/costo/estado). */
export async function listAgentRunsAction(
  slug: string,
  limit = 30,
): Promise<ActionResult<AgentRunView[]>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  const runs = await prisma.agentRun.findMany({
    where: { agent: { projectId: ctx.projectId } },
    include: {
      agent: { select: { role: true } },
      story: { select: { taskNumber: true, title: true } },
    },
    orderBy: { startedAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
  });
  return {
    ok: true,
    data: runs.map((r) => ({
      id: r.id,
      role: r.agent.role,
      storyNumber: r.story?.taskNumber ?? null,
      storyTitle: r.story?.title ?? null,
      status: r.status,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      costUsd: r.costUsd.toString(),
      error: r.error,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
    })),
  };
}

export interface AgentRoleStats {
  role: AgentRole;
  total: number;
  succeeded: number;
  failed: number;
  budgetExceeded: number;
  running: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: string;
}

export interface AgentStatsView {
  byRole: AgentRoleStats[];
  qaRejections: number;
  totalCostUsd: string;
}

/** Métricas de las corridas: tasa de éxito por rol, tokens/costo, cortes de
 * presupuesto y HUs devueltas por QA (vía auditoría task.qa_decision). */
export async function getAgentStatsAction(slug: string): Promise<ActionResult<AgentStatsView>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;

  const [runs, qaRejections] = await Promise.all([
    prisma.agentRun.findMany({
      where: { agent: { projectId: ctx.projectId } },
      select: {
        status: true,
        promptTokens: true,
        completionTokens: true,
        costUsd: true,
        agent: { select: { role: true } },
      },
    }),
    prisma.auditLog.count({
      where: {
        projectId: ctx.projectId,
        action: 'task.qa_decision',
        payload: { path: ['decision'], equals: 'reject' },
      },
    }),
  ]);

  const byRole = new Map<AgentRole, AgentRoleStats>();
  let totalCost = 0;
  for (const r of runs) {
    const role = r.agent.role;
    const s =
      byRole.get(role) ??
      ({
        role,
        total: 0,
        succeeded: 0,
        failed: 0,
        budgetExceeded: 0,
        running: 0,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: '0',
      } satisfies AgentRoleStats);
    s.total += 1;
    if (r.status === 'SUCCEEDED') s.succeeded += 1;
    else if (r.status === 'BUDGET_EXCEEDED') s.budgetExceeded += 1;
    else if (r.status === 'RUNNING') s.running += 1;
    else s.failed += 1;
    s.promptTokens += r.promptTokens;
    s.completionTokens += r.completionTokens;
    const cost = Number(r.costUsd);
    s.costUsd = (Number(s.costUsd) + cost).toFixed(6);
    totalCost += cost;
    byRole.set(role, s);
  }

  return {
    ok: true,
    data: {
      byRole: [...byRole.values()].sort((a, b) => a.role.localeCompare(b.role)),
      qaRejections,
      totalCostUsd: totalCost.toFixed(6),
    },
  };
}

/** Actualiza la config de un agente (modelo LLM / presupuesto por corrida). */
export async function updateAgentAction(
  slug: string,
  agentId: string,
  input: { llmModel?: string; tokenBudget?: number; displayName?: string },
): Promise<ActionResult<AgentView[]>> {
  const ctx = await guard(slug);
  if (!ctx.ok) return ctx;
  const agent = await prisma.agent.findFirst({ where: { id: agentId, projectId: ctx.projectId } });
  if (!agent) return { ok: false, error: 'Agente no encontrado' };
  const llmModel = input.llmModel?.trim();
  if (input.llmModel !== undefined && !llmModel) return { ok: false, error: 'llmModel inválido' };
  if (input.tokenBudget !== undefined && (!Number.isInteger(input.tokenBudget) || input.tokenBudget < 1000)) {
    return { ok: false, error: 'tokenBudget inválido (mínimo 1000 tokens)' };
  }
  const displayName = input.displayName?.trim();
  if (input.displayName !== undefined && !displayName) return { ok: false, error: 'Nombre inválido' };
  if (displayName && displayName.length > 40) return { ok: false, error: 'Nombre demasiado largo (máx. 40)' };
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      ...(llmModel ? { llmModel } : {}),
      ...(input.tokenBudget !== undefined ? { tokenBudget: input.tokenBudget } : {}),
      ...(displayName ? { displayName } : {}),
    },
  });
  await audit({
    actorId: ctx.userId,
    action: 'agent.update',
    resourceType: 'agent',
    resourceId: agentId,
    projectId: ctx.projectId,
    payload: { llmModel: llmModel ?? null, tokenBudget: input.tokenBudget ?? null, displayName: displayName ?? null },
  });
  revalidatePath(`/projects/${slug}/agents`);
  return { ok: true, data: await loadAgents(ctx.projectId) };
}

/** Enciende/apaga un agente (kill-switch por proyecto). */
export async function setAgentEnabledAction(
  slug: string,
  agentId: string,
  enabled: boolean,
): Promise<ActionResult<AgentView[]>> {
  const ctx = await guard(slug);
  if (!ctx.ok) return ctx;
  const agent = await prisma.agent.findFirst({ where: { id: agentId, projectId: ctx.projectId } });
  if (!agent) return { ok: false, error: 'Agente no encontrado' };
  await prisma.agent.update({ where: { id: agentId }, data: { enabled } });
  await audit({
    actorId: ctx.userId,
    action: 'agent.update',
    resourceType: 'agent',
    resourceId: agentId,
    projectId: ctx.projectId,
    payload: { enabled },
  });
  revalidatePath(`/projects/${slug}/agents`);
  return { ok: true, data: await loadAgents(ctx.projectId) };
}

/**
 * Aplica un PRESET de equipo (ECO/BALANCED/MAX) al proyecto con un click:
 * - Roles ON del preset: se aprovisionan si faltan (sus tokens se devuelven UNA
 *   vez, para configurarlos en el worker) y se les setea modelo + presupuesto +
 *   enabled.
 * - Roles OFF del preset: se apagan si existen (no se aprovisionan si faltan).
 * Persiste el preset activo en Project.teamPreset (informativo).
 */
/**
 * Núcleo de aplicar preset, SIN guard de sesión (el caller controla el acceso:
 * la action de UI o la ruta con API token). Provisiona/actualiza cada rol según
 * el preset y persiste Project.teamPreset.
 */
export async function applyTeamPreset(
  projectId: string,
  slug: string,
  preset: import('@/lib/agents/presets').TeamPreset,
): Promise<{ agents: AgentView[]; minted: Array<{ role: AgentRole; token: string }>; provisioned: number }> {
  const { TEAM_PRESETS, presetMeetsFloor } = await import('@/lib/agents/presets');
  // Guard anti-downgrade: no se puede aplicar un tier por debajo del recomendado
  // (sabemos que degradar deja al desarrollo sin poder avanzar).
  const proj = await prisma.project.findUnique({
    where: { id: projectId },
    select: { recommendedPreset: true },
  });
  if (!presetMeetsFloor(preset, proj?.recommendedPreset)) {
    throw new Error(
      `No se puede bajar a ${preset}: este proyecto necesita al menos ${proj?.recommendedPreset} para poder desarrollarse.`,
    );
  }
  const def = TEAM_PRESETS[preset];
  const existing = await prisma.agent.findMany({
    where: { projectId },
    select: { id: true, role: true },
  });
  const byRole = new Map(existing.map((a) => [a.role, a]));
  const minted: Array<{ role: AgentRole; token: string }> = [];

  for (const role of ROLES) {
    const cfg = def.roles[role];
    const current = byRole.get(role);
    if (!cfg.enabled) {
      if (current) {
        await prisma.agent.update({ where: { id: current.id }, data: { enabled: false } });
      }
      continue; // rol apagado en este preset: no se aprovisiona si falta
    }
    if (!current) {
      const prov = await provisionAgent({
        projectId,
        projectSlug: slug,
        role,
        llmModel: cfg.llmModel,
        tokenBudget: cfg.tokenBudget,
      });
      await prisma.agent.update({ where: { id: prov.agentId }, data: { enabled: true } });
      minted.push({ role, token: prov.tokenPlain });
    } else {
      await prisma.agent.update({
        where: { id: current.id },
        data: { llmModel: cfg.llmModel, tokenBudget: cfg.tokenBudget, enabled: true },
      });
    }
  }

  await prisma.project.update({ where: { id: projectId }, data: { teamPreset: preset } });
  return { agents: await loadAgents(projectId), minted, provisioned: minted.length };
}

export async function applyTeamPresetAction(
  slug: string,
  preset: import('@/lib/agents/presets').TeamPreset,
): Promise<ActionResult<{ agents: AgentView[]; minted: Array<{ role: AgentRole; token: string }> }>> {
  const { isTeamPreset } = await import('@/lib/agents/presets');
  if (!isTeamPreset(preset)) return { ok: false, error: 'Preset inválido' };
  const ctx = await guard(slug);
  if (!ctx.ok) return ctx;

  let result;
  try {
    result = await applyTeamPreset(ctx.projectId, slug, preset);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudo aplicar el preset' };
  }

  await audit({
    actorId: ctx.userId,
    action: 'agent.update',
    resourceType: 'project',
    resourceId: ctx.projectId,
    projectId: ctx.projectId,
    payload: { via: 'preset', preset },
  });

  revalidatePath(`/projects/${slug}/agents`);
  return { ok: true, data: { agents: result.agents, minted: result.minted } };
}

/** Setea el ejecutor de desarrollo del proyecto (KAI | CONSOLE | HYBRID). */
export async function setDevExecutorAction(
  slug: string,
  mode: 'KAI' | 'CONSOLE' | 'HYBRID',
): Promise<ActionResult<{ devExecutor: string }>> {
  if (!['KAI', 'CONSOLE', 'HYBRID'].includes(mode)) return { ok: false, error: 'Modo inválido' };
  const ctx = await guard(slug);
  if (!ctx.ok) return ctx;
  await prisma.project.update({ where: { id: ctx.projectId }, data: { devExecutor: mode } });
  await audit({
    actorId: ctx.userId,
    action: 'agent.update',
    resourceType: 'project',
    resourceId: ctx.projectId,
    projectId: ctx.projectId,
    payload: { via: 'dev-executor', mode },
  });
  revalidatePath(`/projects/${slug}/agents`);
  return { ok: true, data: { devExecutor: mode } };
}

export async function setAgentRuntimeAction(
  slug: string,
  runtime: 'CLOUD' | 'LOCAL',
): Promise<ActionResult<{ agentRuntime: string }>> {
  if (!['CLOUD', 'LOCAL'].includes(runtime)) return { ok: false, error: 'Runtime inválido' };
  const ctx = await guard(slug);
  if (!ctx.ok) return ctx;
  await prisma.project.update({ where: { id: ctx.projectId }, data: { agentRuntime: runtime } });
  await audit({
    actorId: ctx.userId,
    action: 'agent.update',
    resourceType: 'project',
    resourceId: ctx.projectId,
    projectId: ctx.projectId,
    payload: { via: 'agent-runtime', runtime },
  });
  revalidatePath(`/projects/${slug}/agents`);
  return { ok: true, data: { agentRuntime: runtime } };
}

export interface VerifyAgentsResult {
  worker: { reachable: boolean; subscribed: boolean };
  refired: { backlog: number[]; development: number[]; review: number[] };
  skippedRunning: number[];
}

/**
 * Botón «Verificar y reactivar»: diagnóstico + rescate del equipo agéntico.
 * 1) Chequea la salud del worker (¿vivo? ¿suscrito a Redis?).
 * 2) RE-EMITE los eventos de dominio de las HUs no terminadas para que los
 *    agentes retomen labores (caso típico: eventos perdidos durante un redeploy
 *    del worker — la HU queda muda en el tablero):
 *    - Backlog (TODO)        → story.created   (PO refina / Dax / Aria / SM asigna)
 *    - En curso (IN_PROGRESS)→ state_changed   (el Dev retoma; consola no se toca)
 *    - Verificación (REVIEW) → state_changed   (QA + Code Reviewer re-revisan)
 *    Las HUs con una corrida RUNNING se saltan (no duplicar trabajo en vuelo).
 */
export async function verifyAgentsAction(slug: string): Promise<ActionResult<VerifyAgentsResult>> {
  const { publishDomainEvent } = await import('@/lib/agents/events');
  const ctx = await guard(slug);
  if (!ctx.ok) return ctx;

  // 1) Salud del worker: alias interno de la red fusion; fallback al público.
  let reachable = false;
  let subscribed = false;
  for (const url of ['http://axon-agents:3060/health', 'https://axon-agents.fusion-soft-lab.com/health']) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const body = (await res.json()) as { ok?: boolean; subscribed?: boolean };
        reachable = !!body.ok;
        subscribed = !!body.subscribed;
        break;
      }
    } catch {
      /* probar el siguiente */
    }
  }

  // 2) HUs no terminadas + corridas en vuelo.
  const tasks = await prisma.task.findMany({
    where: { projectId: ctx.projectId, state: { category: { in: ['OPEN', 'IN_PROGRESS', 'REVIEW'] } } },
    include: { state: { select: { id: true, name: true, category: true } } },
    orderBy: { taskNumber: 'asc' },
  });
  const runningIds = new Set(
    (
      await prisma.agentRun.findMany({
        where: { status: 'RUNNING', agent: { projectId: ctx.projectId } },
        select: { storyId: true },
      })
    )
      .map((r) => r.storyId)
      .filter((x): x is string => !!x),
  );

  const refired: VerifyAgentsResult['refired'] = { backlog: [], development: [], review: [] };
  const skippedRunning: number[] = [];
  for (const t of tasks) {
    if (runningIds.has(t.id)) {
      skippedRunning.push(t.taskNumber);
      continue; // hay una corrida en vuelo: no duplicar
    }
    const base = {
      projectId: ctx.projectId,
      storyId: t.id,
      storyNumber: t.taskNumber,
      toState: { id: t.state.id, name: t.state.name, category: t.state.category },
      actorId: ctx.userId,
      assigneeId: t.assigneeId ?? null,
    };
    if (t.state.category === 'OPEN') {
      publishDomainEvent({ ...base, type: 'story.created' });
      refired.backlog.push(t.taskNumber);
    } else {
      publishDomainEvent({ ...base, type: 'story.state_changed' });
      (t.state.category === 'IN_PROGRESS' ? refired.development : refired.review).push(t.taskNumber);
    }
  }

  await audit({
    actorId: ctx.userId,
    action: 'agent.update',
    resourceType: 'project',
    resourceId: ctx.projectId,
    projectId: ctx.projectId,
    payload: { via: 'verify', reachable, subscribed, refired, skippedRunning },
  });

  return { ok: true, data: { worker: { reachable, subscribed }, refired, skippedRunning } };
}

export interface ProvisionTeamResult {
  provisioned: number;
  enabled: number;
  /** Agentes preexistentes cuyo token se rotó+selló para el worker multi-tenant. */
  resealed: number;
  agents: AgentView[];
}

/**
 * Provisiona (o completa) el equipo por defecto de un proyecto: los 9 roles,
 * habilitados, con los modelos estilo-axon. Idempotente y SIN guard de sesión
 * (el caller —API/route o el hook de creación— hace el control de acceso). El
 * worker multi-tenant toma el equipo en su próximo refresco.
 */
export async function provisionDefaultTeam(
  projectId: string,
  slug: string,
): Promise<ProvisionTeamResult> {
  const { rotateAgentToken } = await import('@/lib/agents/provision');
  // Roles que ya tienen su token sellado en el store de runtime.
  const sealedRoles = new Set(
    (await prisma.agentRuntimeToken.findMany({ where: { projectId }, select: { role: true } })).map((r) => r.role),
  );
  let provisioned = 0;
  let enabled = 0;
  let resealed = 0;
  for (const role of ROLES) {
    const existing = await prisma.agent.findUnique({
      where: { projectId_role: { projectId, role } },
      select: { id: true, enabled: true },
    });
    if (!existing) {
      try {
        await provisionAgent({ projectId, projectSlug: slug, role, llmModel: DEFAULT_ROLE_MODEL[role] });
        await prisma.agent.update({
          where: { projectId_role: { projectId, role } },
          data: { enabled: true },
        });
        provisioned += 1;
        enabled += 1;
      } catch {
        /* carrera / ya existe: seguir */
      }
    } else {
      if (!existing.enabled) {
        await prisma.agent.update({ where: { id: existing.id }, data: { enabled: true } });
        enabled += 1;
      }
      // Auto-sanación: un agente preexistente sin token sellado (ej. los de axon,
      // provisionados antes del store) se rota+sella para que el worker lo sirva.
      if (!sealedRoles.has(role)) {
        try {
          await rotateAgentToken({ projectId, projectSlug: slug, role });
          resealed += 1;
        } catch {
          /* best-effort */
        }
      }
    }
  }
  return { provisioned, enabled, resealed, agents: await loadAgents(projectId) };
}
