import { notFound } from 'next/navigation';
import { assertProjectMember } from '@/lib/auth/membership';
import { prisma } from '@/lib/db';
import { isInfraLlmConfigured } from '@/lib/ai/infra-llm';
import { buildProjectGraph, graphSignature } from '@/lib/graph/build';
import { getServerT } from '@/lib/i18n/server';
import { PageHeader, Eyebrow } from '@/components/ui';
import { ContextGraphView } from './ContextGraphView';
import { AnalysisPanel } from '../plan/AnalysisPanel';
import type { ContextSummaryView } from '@/lib/actions/context';
import styles from './context.module.scss';

export default async function ContextPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) notFound();
  const t = await getServerT();

  const graph = await buildProjectGraph(ctx.projectId);
  const sig = graphSignature(graph);
  const row = await prisma.contextSummary.findUnique({
    where: { scope_refId: { scope: 'PROJECT', refId: ctx.projectId } },
  });
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
