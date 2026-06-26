'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { assertProjectMember } from '@/lib/auth/membership';
import { isGraphifyConfigured } from '@/lib/analysis/graphify-client';
import { markAnalyzing, runProjectAnalysis, collectAnalyzableRepos } from '@/lib/analysis/run';
import type { GodNode } from '@/lib/analysis/describe';
import type { ActionResult } from './projects';

export interface AnalysisView {
  configured: boolean; // whether graphify-svc is wired up on this instance
  status: 'NONE' | 'PENDING' | 'ANALYZING' | 'READY' | 'FAILED';
  summary: string | null;
  godNodes: GodNode[];
  stats: Record<string, unknown> | null;
  backend: string | null;
  analyzableRepoCount: number;
  error: string | null;
  updatedAt: string | null;
}

async function loadView(projectId: string): Promise<AnalysisView> {
  const [row, repos] = await Promise.all([
    prisma.codeAnalysis.findUnique({ where: { projectId } }),
    collectAnalyzableRepos(projectId),
  ]);
  return {
    configured: isGraphifyConfigured(),
    status: row?.status ?? 'NONE',
    summary: row?.summary ?? null,
    godNodes: (row?.godNodes as GodNode[] | null) ?? [],
    stats: (row?.stats as Record<string, unknown> | null) ?? null,
    backend: row?.backend ?? null,
    analyzableRepoCount: repos.inputs.length,
    error: row?.error ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

/** Read the current analysis state for a project (used for polling). */
export async function getAnalysisAction(slug: string): Promise<ActionResult<AnalysisView>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  return { ok: true, data: await loadView(ctx.projectId) };
}

/** Trigger (or re-run) the code analysis for a project. OWNER/ADMIN only.
 *  Sets status ANALYZING and runs in the background; the UI polls getAnalysisAction. */
export async function analyzeProjectAction(slug: string): Promise<ActionResult<AnalysisView>> {
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role !== 'OWNER' && ctx.role !== 'ADMIN') {
    return { ok: false, error: 'Solo OWNER/ADMIN pueden analizar el proyecto' };
  }
  if (!isGraphifyConfigured()) {
    return { ok: false, error: 'El análisis de código no está configurado en esta instancia (GRAPHIFY_URL)' };
  }

  const current = await prisma.codeAnalysis.findUnique({
    where: { projectId: ctx.projectId },
    select: { status: true },
  });
  if (current?.status === 'ANALYZING') {
    return { ok: false, error: 'Ya hay un análisis en curso' };
  }

  const { inputs } = await collectAnalyzableRepos(ctx.projectId);
  if (inputs.length === 0) {
    return {
      ok: false,
      error: 'Vincula al menos un repo con identidad de GitHub antes de analizar',
    };
  }

  await markAnalyzing(ctx.projectId);
  await audit({
    actorId: ctx.userId,
    action: 'analysis.start',
    resourceType: 'code_analysis',
    resourceId: ctx.projectId,
    projectId: ctx.projectId,
    payload: { repos: inputs.length },
  });

  // Background run (Node process is long-lived/self-hosted); state is persisted
  // to the CodeAnalysis row so the UI can poll getAnalysisAction.
  const bgProjectId = ctx.projectId;
  const bgAuthorId = ctx.userId;
  void (async () => {
    try {
      await runProjectAnalysis({ projectId: bgProjectId, authorId: bgAuthorId });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[analysis] background run failed:', err);
    }
  })();

  revalidatePath(`/projects/${slug}/plan`);
  return { ok: true, data: await loadView(ctx.projectId) };
}
