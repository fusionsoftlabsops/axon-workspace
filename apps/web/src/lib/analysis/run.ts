/**
 * Orchestrates a project's code analysis: gather its repos → call graphify-svc
 * → persist the CodeAnalysis row → derive the brief/god-nodes → seed the brain.
 *
 * Designed to be invoked fire-and-forget from the action (the Node process is
 * long-lived/self-hosted), with all state persisted to the CodeAnalysis row so
 * the UI can poll. Mirrors the StoryDraft GENERATING→READY/FAILED lifecycle.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { analyzeRepos, type GraphifyRepoInput } from './graphify-client';
import { describeCodeGraph, type RepoRef } from './describe';
import { seedBrainFromAnalysis } from './seed-brain';

/** Build the graphify-svc repo payload + the human-facing repo refs from the
 *  project's linked ProjectRepo rows. Skips repos with no GitHub identity. */
export async function collectAnalyzableRepos(
  projectId: string,
): Promise<{ inputs: GraphifyRepoInput[]; refs: RepoRef[] }> {
  const repos = await prisma.projectRepo.findMany({
    where: { projectId },
    select: { name: true, kind: true, url: true, githubFullName: true, defaultBranch: true },
  });
  const inputs: GraphifyRepoInput[] = [];
  const refs: RepoRef[] = [];
  for (const r of repos) {
    // graphify-svc needs a GitHub identity to clone.
    if (!r.githubFullName && !(r.url && /github\.com/i.test(r.url))) continue;
    inputs.push({
      name: r.name,
      kind: r.kind,
      githubFullName: r.githubFullName,
      cloneUrl: r.url,
      branch: r.defaultBranch ?? 'main',
    });
    refs.push({ name: r.name, kind: r.kind, githubFullName: r.githubFullName });
  }
  return { inputs, refs };
}

/** Ensure a CodeAnalysis row exists and mark it ANALYZING. */
export async function markAnalyzing(projectId: string): Promise<void> {
  await prisma.codeAnalysis.upsert({
    where: { projectId },
    create: { projectId, status: 'ANALYZING' },
    update: { status: 'ANALYZING', error: null },
  });
}

/** Run the full analysis and persist the result. Never throws — failures are
 *  recorded on the CodeAnalysis row as FAILED. */
export async function runProjectAnalysis(params: {
  projectId: string;
  authorId: string;
  backend?: string;
}): Promise<void> {
  const { projectId, authorId, backend } = params;
  try {
    const { inputs, refs } = await collectAnalyzableRepos(projectId);
    if (inputs.length === 0) {
      await prisma.codeAnalysis.update({
        where: { projectId },
        data: {
          status: 'FAILED',
          error: 'No hay repos vinculados con identidad de GitHub para analizar.',
        },
      });
      return;
    }

    const result = await analyzeRepos(inputs, { backend });
    const { summary, godNodes } = describeCodeGraph(result.graph, refs);

    await prisma.codeAnalysis.update({
      where: { projectId },
      data: {
        status: 'READY',
        graph: result.graph as unknown as Prisma.InputJsonValue,
        summary,
        godNodes: godNodes as unknown as Prisma.InputJsonValue,
        stats: result.stats as unknown as Prisma.InputJsonValue,
        backend: result.backend,
        repos: refs as unknown as Prisma.InputJsonValue,
        error: null,
      },
    });

    await seedBrainFromAnalysis({ projectId, authorId, summary, godNodes }).catch((err) => {
      // Seeding is best-effort; the analysis itself already succeeded.
      // eslint-disable-next-line no-console
      console.error('[analysis] brain seeding failed:', err);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido en el análisis';
    await prisma.codeAnalysis
      .update({ where: { projectId }, data: { status: 'FAILED', error: message } })
      .catch(() => {});
  }
}
