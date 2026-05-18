import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { Masthead, Eyebrow, Tag, Stat } from '@/components/ui';
import styles from './stories.module.scss';

export default async function StoriesIndex({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const project = await prisma.project.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      repoPath: true,
      members: { where: { userId }, select: { role: true } },
    },
  });
  if (!project || project.members.length === 0) notFound();

  const [drafts, credCount, totalDrafts, totalPublished] = await Promise.all([
    prisma.storyDraft.findMany({
      where: { projectId: project.id, authorId: userId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        provider: true,
        model: true,
        status: true,
        summary: true,
        rawInput: true,
        taskId: true,
        estimatedCostUsd: true,
        createdAt: true,
      },
    }),
    prisma.llmCredential.count({
      where: { userId, revokedAt: null },
    }),
    prisma.storyDraft.count({ where: { projectId: project.id, authorId: userId } }),
    prisma.storyDraft.count({
      where: { projectId: project.id, authorId: userId, status: 'PUBLISHED' },
    }),
  ]);

  const noCredentials = credCount === 0;
  const noRepo = !project.repoPath;

  return (
    <main className={styles.page}>
      <Masthead
        eyebrow={<Eyebrow ornament="reference">Historias de usuario · borradores</Eyebrow>}
        deck="Parte del código y del cerebro del proyecto. Genera, refina, publica."
        size="lg"
      >
        El editor de HUs
      </Masthead>

      <div className={styles.statsStrip}>
        <Stat label="Borradores" value={totalDrafts} />
        <Stat label="Publicados" value={totalPublished} />
        <Stat label="Credenciales LLM" value={credCount} />
        <Stat label="Repo" value={project.repoPath ? '✓' : '—'} />
      </div>

      {(noCredentials || noRepo) && (
        <aside className={styles.setup}>
          <Eyebrow tone="accent">Setup pendiente</Eyebrow>
          <ul>
            {noCredentials && (
              <li>
                Configura al menos una credencial de LLM en{' '}
                <Link href="/settings/llm-credentials">/settings/llm-credentials</Link>.
              </li>
            )}
            {noRepo && (
              <li>
                Configura la ruta del repositorio en{' '}
                <Link href={`/projects/${slug}/settings`}>los ajustes del proyecto</Link>.
              </li>
            )}
          </ul>
        </aside>
      )}

      <div className={styles.toolbar}>
        <Link
          href={`/projects/${slug}/stories/new`}
          className={`${styles.newBtn} ${noCredentials ? styles.disabled : ''}`}
          aria-disabled={noCredentials}
        >
          + Nueva HU
        </Link>
      </div>

      {drafts.length === 0 ? (
        <p className={styles.empty}>
          Aún no hay borradores. Empieza describiendo una necesidad concreta.
        </p>
      ) : (
        <ul className={styles.draftList}>
          {drafts.map((d) => (
            <li key={d.id} className={styles.draftItem}>
              <Link href={`/projects/${slug}/stories/drafts/${d.id}`}>
                <div className={styles.draftHead}>
                  <Eyebrow tone="muted">
                    {d.provider} · {d.model} · {formatDate(d.createdAt)}
                  </Eyebrow>
                  <Tag tone={statusTone(d.status)}>{d.status}</Tag>
                </div>
                <p className={styles.draftSummary}>
                  {d.summary?.slice(0, 200) ?? d.rawInput.slice(0, 200)}
                </p>
                <div className={styles.draftMeta}>
                  <span>${d.estimatedCostUsd.toString()}</span>
                  {d.taskId && <span className={styles.published}>→ Publicado como tarea</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function statusTone(status: string): 'subtle' | 'accent' | 'ink' {
  switch (status) {
    case 'GENERATING':
      return 'accent';
    case 'READY':
      return 'ink';
    case 'PUBLISHED':
      return 'subtle';
    case 'ERRORED':
      return 'accent';
    default:
      return 'subtle';
  }
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' });
}
