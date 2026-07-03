'use server';

import { revalidatePath } from 'next/cache';
import type { AgentRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { assertProjectMember } from '@/lib/auth/membership';
import { provisionAgent, AGENT_DISPLAY_NAMES } from '@/lib/agents/provision';
import type { ActionResult } from './projects';

export interface AgentView {
  id: string;
  role: AgentRole;
  displayName: string;
  llmModel: string;
  credentialRef: string | null;
  tokenBudget: number;
  enabled: boolean;
  tokenPrefix: string | null;
  createdAt: string;
}

const ROLES: AgentRole[] = ['SM', 'DEV', 'QA'];

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
    displayName: AGENT_DISPLAY_NAMES[a.role],
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

/** Actualiza la config de un agente (modelo LLM / presupuesto por corrida). */
export async function updateAgentAction(
  slug: string,
  agentId: string,
  input: { llmModel?: string; tokenBudget?: number },
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
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      ...(llmModel ? { llmModel } : {}),
      ...(input.tokenBudget !== undefined ? { tokenBudget: input.tokenBudget } : {}),
    },
  });
  await audit({
    actorId: ctx.userId,
    action: 'agent.update',
    resourceType: 'agent',
    resourceId: agentId,
    projectId: ctx.projectId,
    payload: { llmModel: llmModel ?? null, tokenBudget: input.tokenBudget ?? null },
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
