import { notFound } from 'next/navigation';
import { assertProjectMember } from '@/lib/auth/membership';
import { prisma } from '@/lib/db';
import { isInfraLlmConfigured } from '@/lib/ai/infra-llm';
import { buildProjectGraph, graphSignature } from '@/lib/graph/build';
import { getServerT } from '@/lib/i18n/server';
import { PageHeader, Eyebrow } from '@/components/ui';
import { ContextGraphView } from './ContextGraphView';
import { CodeGraphView } from './CodeGraphView';
import { AnalysisPanel } from '../plan/AnalysisPanel';
import { subsetCodeGraph, type CodeGraph } from '@/lib/analysis/describe';
import type { ContextSummaryView } from '@/lib/actions/context';
import styles from './context.module.scss';

export default async function ContextPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) notFound();
  const t = await getServerT();

  const graph = await buildProjectGraph(ctx.projectId);
  const sig = graphSignature(graph);
  const [row, codeAnalysis] = await Promise.all([
    prisma.contextSummary.findUnique({
      where: { scope_refId: { scope: 'PROJECT', refId: ctx.projectId } },
    }),
    prisma.codeAnalysis.findUnique({
      where: { projectId: ctx.projectId },
      select: { status: true, graph: true },
    }),
  ]);
  // The full code graph can be thousands of nodes — subset to the busiest ones
  // server-side so only a readable slice crosses the wire.
  const codeSubset =
    codeAnalysis?.status === 'READY' && codeAnalysis.graph
      ? subsetCodeGraph(codeAnalysis.graph as unknown as CodeGraph, 90)
      : null;
  const projectSummary: ContextSummaryView = {
    scope: 'PROJECT',
    refId: '',
    configured: isInfraLlmConfigured(),
    body: row?.body ?? null,
    model: row?.model ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    stale: row ? row.signature !== sig : false,
  };

  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow={<Eyebrow>{t('Contexto del proyecto', 'Project context')}</Eyebrow>}
        title={t('Grafo de contexto', 'Context graph')}
        description={t(
          'El grafo de código (brownfield) y cómo se conectan HUs, sprints y cerebro — fundamenta las HUs nuevas y se actualiza con el trabajo.',
          'The code graph (brownfield) and how stories, sprints and brain connect — it grounds new stories and updates as work progresses.',
        )}
      />

      {/* Code knowledge graph (graphify): generate it from the project's real code
          so new stories are grounded in what already exists (brownfield). The
          READY summary feeds the planner via codeContext() in planning.ts. */}
      <section className={styles.codeGraph}>
        <Eyebrow>{t('Grafo de código', 'Code graph')}</Eyebrow>
        <p className={styles.lead}>
          {t(
            'Genera un grafo de conocimiento del código existente. Sirve de contexto para redactar HUs nuevas alineadas con lo que ya hay.',
            'Generate a knowledge graph of the existing code. It serves as context for writing new stories aligned with what already exists.',
          )}
        </p>
        {codeSubset && codeSubset.nodes.length > 0 && <CodeGraphView subset={codeSubset} />}
        <AnalysisPanel slug={slug} canWrite={ctx.role !== 'VIEWER'} />
      </section>

      <ContextGraphView
        slug={slug}
        canWrite={ctx.role !== 'VIEWER'}
        graph={graph}
        initialProjectSummary={projectSummary}
      />
    </main>
  );
}
