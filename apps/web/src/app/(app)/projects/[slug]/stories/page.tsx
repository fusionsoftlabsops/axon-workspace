import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { Masthead, Eyebrow, Tag, Stat } from '@/components/ui';
import { getServerT, getServerLang } from '@/lib/i18n/server';
import styles from './stories.module.scss';

export default async function StoriesIndex({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getServerT();
  const lang = await getServerLang();
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
        eyebrow={<Eyebrow ornament="reference">{t('Historias de usuario · borradores', 'User stories · drafts')}</Eyebrow>}
        deck={t('Parte del código y del cerebro del proyecto. Genera, refina, publica.', 'Part of the project’s code and brain. Generate, refine, publish.')}
        size="lg"
      >
        {t('El editor de HUs', 'The user story editor')}
      </Masthead>

      <div className={styles.statsStrip}>
        <Stat label={t('Borradores', 'Drafts')} value={totalDrafts} />
        <Stat label={t('Publicados', 'Published')} value={totalPublished} />
        <Stat label={t('Credenciales LLM', 'LLM credentials')} value={credCount} />
        <Stat label={t('Repo', 'Repo')} value={project.repoPath ? '✓' : '—'} />
      </div>

      {(noCredentials || noRepo) && (
        <aside className={styles.setup}>
          <Eyebrow tone="accent">{t('Setup pendiente', 'Setup pending')}</Eyebrow>
          <ul>
            {noCredentials && (
              <li>
                {t('Configura al menos una credencial de LLM en', 'Configure at least one LLM credential at')}{' '}
                <Link href="/settings/llm-credentials">/settings/llm-credentials</Link>.
              </li>
            )}
            {noRepo && (
              <li>
                {t('Configura la ruta del repositorio en', 'Configure the repository path in')}{' '}
                <Link href={`/projects/${slug}/settings`}>{t('los ajustes del proyecto', 'the project settings')}</Link>.
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
          {t('+ Nueva HU', '+ New story')}
        </Link>
      </div>

      {drafts.length === 0 ? (
        <p className={styles.empty}>
          {t('Aún no hay borradores. Empieza describiendo una necesidad concreta.', 'No drafts yet. Start by describing a concrete need.')}
        </p>
      ) : (
        <ul className={styles.draftList}>
          {drafts.map((d) => (
            <li key={d.id} className={styles.draftItem}>
              <Link href={`/projects/${slug}/stories/drafts/${d.id}`}>
                <div className={styles.draftHead}>
                  <Eyebrow tone="muted">
                    {d.provider} · {d.model} · {formatDate(d.createdAt, lang)}
                  </Eyebrow>
                  <Tag tone={statusTone(d.status)}>{d.status}</Tag>
                </div>
                <p className={styles.draftSummary}>
                  {d.summary?.slice(0, 200) ?? d.rawInput.slice(0, 200)}
                </p>
                <div className={styles.draftMeta}>
                  <span>${d.estimatedCostUsd.toString()}</span>
                  {d.taskId && <span className={styles.published}>{t('→ Publicado como tarea', '→ Published as task')}</span>}
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

function formatDate(d: Date, lang: 'es' | 'en'): string {
  return d.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}
