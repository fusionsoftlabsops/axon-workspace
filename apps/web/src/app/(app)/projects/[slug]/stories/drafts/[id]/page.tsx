import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { PageHeader, Eyebrow } from '@/components/ui';
import { getServerT, getServerLang } from '@/lib/i18n/server';
import { DraftView } from './DraftView';
import styles from '../../stories.module.scss';

export default async function DraftPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const t = await getServerT();
  const lang = await getServerLang();
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const project = await prisma.project.findUnique({
    where: { slug },
    select: {
      id: true,
      members: { where: { userId }, select: { role: true } },
      workflows: {
        where: { isDefault: true },
        include: { states: { orderBy: { order: 'asc' } } },
      },
    },
  });
  if (!project || project.members.length === 0) notFound();

  const draft = await prisma.storyDraft.findUnique({
    where: { id },
    select: {
      id: true,
      projectId: true,
      authorId: true,
      status: true,
      errorMessage: true,
      provider: true,
      model: true,
      rawInput: true,
      summary: true,
      acceptanceCriteria: true,
      technicalContext: true,
      subtaskBreakdown: true,
      filesToTouch: true,
      risks: true,
      inputTokens: true,
      outputTokens: true,
      estimatedCostUsd: true,
      durationMs: true,
      taskId: true,
      citedMemoryIds: true,
      createdAt: true,
    },
  });
  if (!draft || draft.projectId !== project.id || draft.authorId !== userId) notFound();

  const states = project.workflows[0]?.states ?? [];
  const role = project.members[0]!.role;

  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow={
          <Eyebrow>
            {t('Borrador', 'Draft')} · {draft.provider} · {draft.model} ·{' '}
            {draft.createdAt.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
              day: '2-digit',
              month: 'short',
              year: '2-digit',
            })}
          </Eyebrow>
        }
        title={draft.summary?.split('\n')[0]?.slice(0, 120) ?? t('HU en redacción', 'Story in progress')}
      />

      <DraftView
        projectSlug={slug}
        initialDraft={{
          id: draft.id,
          status: draft.status,
          errorMessage: draft.errorMessage,
          rawInput: draft.rawInput,
          summary: draft.summary,
          acceptanceCriteria: draft.acceptanceCriteria,
          technicalContext: draft.technicalContext,
          subtaskBreakdown: draft.subtaskBreakdown as Array<{
            title: string;
            description?: string;
            priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
          }> | null,
          filesToTouch: draft.filesToTouch as Array<{ path: string; reason: string }> | null,
          risks: draft.risks,
          inputTokens: draft.inputTokens,
          outputTokens: draft.outputTokens,
          estimatedCostUsd: draft.estimatedCostUsd.toString(),
          durationMs: draft.durationMs,
          taskId: draft.taskId,
          citedMemoryIds: draft.citedMemoryIds,
        }}
        states={states.map((s) => ({ id: s.id, name: s.name, color: s.color }))}
        canPublish={role !== 'VIEWER'}
      />
    </main>
  );
}
