import { notFound } from 'next/navigation';
import { assertProjectMember } from '@/lib/auth/membership';
import { prisma } from '@/lib/db';
import { isInfraLlmConfigured } from '@/lib/ai/infra-llm';
import { buildProjectGraph, graphSignature } from '@/lib/graph/build';
import { getServerT } from '@/lib/i18n/server';
import { PageHeader, Eyebrow } from '@/components/ui';
import { ContextGraphView } from './ContextGraphView';
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
          'Cómo se conectan HUs, sprints y conocimiento del cerebro; se actualiza a medida que avanza el trabajo.',
          'How stories, sprints and brain knowledge connect; it updates as work progresses.',
        )}
      />
      <ContextGraphView
        slug={slug}
        canWrite={ctx.role !== 'VIEWER'}
        graph={graph}
        initialProjectSummary={projectSummary}
      />
    </main>
  );
}
