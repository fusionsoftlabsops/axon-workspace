'use server';

import { assertProjectMember } from '@/lib/auth/membership';
import { prisma } from '@/lib/db';
import { getServerLang } from '@/lib/i18n/server';
import { isInfraLlmConfigured, infraModelName } from '@/lib/ai/infra-llm';
import {
  buildProjectGraph,
  focusSubgraph,
  graphSignature,
  type ContextGraph,
} from '@/lib/graph/build';
import { summarizeGraph } from '@/lib/graph/summary';
import type { ActionResult } from './projects';

export type ContextScope = 'PROJECT' | 'TASK';

export interface ContextSummaryView {
  scope: ContextScope;
  refId: string;
  configured: boolean; // whether the infra model is wired up
  body: string | null;
  model: string | null;
  updatedAt: string | null;
  stale: boolean; // cached summary predates the current graph signature
}

export async function getContextGraphAction(slug: string): Promise<ActionResult<{ graph: ContextGraph }>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  const graph = await buildProjectGraph(ctx.projectId);
  return { ok: true, data: { graph } };
}

/** Resolve the relevant (sub)graph + its change-signature for a scope/ref. */
async function graphForScope(
  projectId: string,
  scope: ContextScope,
  refId: string,
): Promise<{ graph: ContextGraph; signature: string } | null> {
  const full = await buildProjectGraph(projectId);
  if (scope === 'PROJECT') return { graph: full, signature: graphSignature(full) };
  const sub = focusSubgraph(full, refId);
  if (sub.nodes.length === 0) return null;
  return { graph: sub, signature: graphSignature(sub) };
}

async function loadView(
  scope: ContextScope,
  refId: string,
  signature: string,
): Promise<ContextSummaryView> {
  const row = await prisma.contextSummary.findUnique({ where: { scope_refId: { scope, refId } } });
  return {
    scope,
    refId,
    configured: isInfraLlmConfigured(),
    body: row?.body ?? null,
    model: row?.model ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    stale: row ? row.signature !== signature : false,
  };
}

/** Read the cached summary for a scope (and whether it's stale vs the live graph). */
export async function getContextSummaryAction(
  slug: string,
  scope: ContextScope,
  refId: string,
): Promise<ActionResult<ContextSummaryView>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  // PROJECT summaries key on the project id (the client only knows the slug).
  const ref = scope === 'PROJECT' ? ctx.projectId : refId;
  const resolved = await graphForScope(ctx.projectId, scope, ref);
  if (!resolved) return { ok: false, error: 'Nodo no encontrado' };
  return { ok: true, data: await loadView(scope, ref, resolved.signature) };
}

/** (Re)generate the context summary via the self-hosted infra model and cache it. */
export async function generateContextSummaryAction(
  slug: string,
  scope: ContextScope,
  refId: string,
): Promise<ActionResult<ContextSummaryView>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (!isInfraLlmConfigured()) {
    return { ok: false, error: 'El modelo de contexto no está configurado en esta instancia' };
  }
  const ref = scope === 'PROJECT' ? ctx.projectId : refId;
  const resolved = await graphForScope(ctx.projectId, scope, ref);
  if (!resolved) return { ok: false, error: 'Nodo no encontrado' };

  const lang = await getServerLang();
  let body: string;
  try {
    body = await summarizeGraph(resolved.graph, scope, lang, scope === 'TASK' ? ref : undefined);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error del modelo de contexto' };
  }

  const model = infraModelName();
  await prisma.contextSummary.upsert({
    where: { scope_refId: { scope, refId: ref } },
    create: { projectId: ctx.projectId, scope, refId: ref, body, model, signature: resolved.signature },
    update: { body, model, signature: resolved.signature },
  });
  return { ok: true, data: await loadView(scope, ref, resolved.signature) };
}
