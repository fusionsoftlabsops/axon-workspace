import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getServerT } from '@/lib/i18n/server';
import { Eyebrow, RuleDivider, Tag } from '@/components/ui';
import { MemoryActions } from './MemoryActions';
import styles from './detail.module.scss';

function typeLabel(t: <T>(es: T, en: T) => T): Record<string, string> {
  return {
    DECISION: t('Decisión', 'Decision'),
    GOTCHA: t('Trampa', 'Gotcha'),
    PATTERN: t('Patrón', 'Pattern'),
    ANTIPATTERN: t('Anti-patrón', 'Anti-pattern'),
    RUNBOOK: t('Runbook', 'Runbook'),
    GLOSSARY: t('Glosario', 'Glossary'),
    NOTE: t('Nota', 'Note'),
  };
}

export default async function MemoryDetailPage({
  params,
}: {
  params: Promise<{ slug: string; memoryId: string }>;
}) {
  const { slug, memoryId } = await params;
  const t = await getServerT();
  const TYPE_LABEL = typeLabel(t);
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const memory = await prisma.brainMemory.findUnique({
    where: { id: memoryId },
    include: {
      author: { select: { id: true, name: true } },
      ownerUser: { select: { id: true, name: true } },
      sourceTask: { select: { taskNumber: true, title: true } },
      supersededBy: { select: { id: true, title: true } },
      supersedes: { select: { id: true, title: true, createdAt: true } },
      citations: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          citedInTask: { select: { taskNumber: true, title: true } },
          citedByUser: { select: { name: true } },
        },
      },
      project: {
        select: {
          slug: true,
          members: { where: { userId }, select: { role: true } },
        },
      },
    },
  });
  if (!memory || memory.project.slug !== slug || memory.project.members.length === 0) {
    notFound();
  }

  const role = memory.project.members[0]!.role;
  if (memory.scope === 'LOCAL' && memory.ownerUserId !== userId && role !== 'OWNER') {
    notFound();
  }

  const canEdit =
    memory.authorId === userId ||
    memory.ownerUserId === userId ||
    role === 'OWNER' ||
    role === 'ADMIN';

  const deck = extractDeck(memory.body);

  return (
    <div className={styles.page}>
      <aside className={styles.aside}>
        <Link href={`/projects/${slug}/brain`} className={styles.back}>
          ← {t('Volver al cerebro', 'Back to the brain')}
        </Link>
        <div className={styles.stamps}>
          <span className={styles.typeStamp}>{TYPE_LABEL[memory.type] ?? memory.type}</span>
          <span
            className={
              memory.scope === 'PROJECT' ? styles.scopeStampProject : styles.scopeStampLocal
            }
          >
            {memory.scope === 'PROJECT' ? t('Principal', 'Main') : t('Local', 'Local')}
          </span>
          {memory.status !== 'ACTIVE' && (
            <span className={styles.statusStamp}>{memory.status}</span>
          )}
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.eyebrowLine}>
          <Eyebrow ornament="section" tone="accent">
            {memory.sourceTask
              ? t(
                  `Memoria · de la tarea #${memory.sourceTask.taskNumber}`,
                  `Memory · from task #${memory.sourceTask.taskNumber}`,
                )
              : t('Memoria capturada a mano', 'Manually captured memory')}
          </Eyebrow>
        </div>

        <h1 className={styles.title}>{memory.title}</h1>

        {deck && <p className={styles.deck}>{deck}</p>}

        <p className={styles.metaLine}>
          {t('por', 'by')} <strong>{memory.author.name}</strong>
          {memory.sourceTask && (
            <>
              {' · '}
              <Link href={`/projects/${slug}/board?task=${memory.sourceTask.taskNumber}`}>
                #{memory.sourceTask.taskNumber} {memory.sourceTask.title}
              </Link>
            </>
          )}
          {' · '}
          {memory.citationCount}{' '}
          {memory.citationCount === 1 ? t('cita', 'citation') : t('citas', 'citations')}
          {' · '}
          {t('actualizada', 'updated')} {memory.updatedAt.toLocaleString()}
        </p>

        {memory.tags.length > 0 && (
          <div className={styles.tagLine}>
            {memory.tags.map((t) => (
              <Tag key={t} tone="subtle">
                <Link
                  href={`/projects/${slug}/brain?tag=${encodeURIComponent(t)}`}
                  style={{ color: 'inherit', textDecoration: 'none' }}
                >
                  {t}
                </Link>
              </Tag>
            ))}
          </div>
        )}

        {memory.supersededBy && (
          <div className={styles.notice}>
            {t('Esta entrada fue reemplazada por', 'This entry was superseded by')}{' '}
            <Link href={`/projects/${slug}/brain/${memory.supersededBy.id}`}>
              {memory.supersededBy.title}
            </Link>
            .
          </div>
        )}

        <article className={styles.body}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{memory.body}</ReactMarkdown>
        </article>
      </main>

      <aside className={styles.sidebar}>
        {canEdit && memory.status === 'ACTIVE' && (
          <MemoryActions
            projectSlug={slug}
            memoryId={memory.id}
            scope={memory.scope}
            currentBody={memory.body}
            currentTitle={memory.title}
            currentType={memory.type}
            currentTags={memory.tags}
          />
        )}

        <div className={styles.marginaliaPanel}>
          <div className={styles.marginaliaItem}>
            <span className={styles.marginaliaLabel}>{t('Autor', 'Author')}</span>
            <span className={styles.marginaliaValue}>{memory.author.name}</span>
          </div>
          {memory.ownerUser && memory.scope === 'LOCAL' && (
            <div className={styles.marginaliaItem}>
              <span className={styles.marginaliaLabel}>{t('Local de', 'Local to')}</span>
              <span className={styles.marginaliaValue}>{memory.ownerUser.name}</span>
            </div>
          )}
          <div className={styles.marginaliaItem}>
            <span className={styles.marginaliaLabel}>{t('Creada', 'Created')}</span>
            <span className={styles.marginaliaValue}>
              {memory.createdAt.toLocaleDateString()}
            </span>
          </div>
          <div className={styles.marginaliaItem}>
            <span className={styles.marginaliaLabel}>{t('Última citación', 'Last citation')}</span>
            <span className={styles.marginaliaValue}>
              {memory.lastCitedAt ? memory.lastCitedAt.toLocaleDateString() : t('sin citar', 'never cited')}
            </span>
          </div>
        </div>
      </aside>

      {memory.supersedes.length > 0 && (
        <section className={styles.section}>
          <h2>{t('Reemplaza a', 'Supersedes')}</h2>
          <ul className={styles.lineageList}>
            {memory.supersedes.map((s) => (
              <li key={s.id}>
                <Link href={`/projects/${slug}/brain/${s.id}`} className={styles.citationLink}>
                  {s.title}
                </Link>
                <span className={styles.lineageMeta}>· {s.createdAt.toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.section}>
        <h2>{t('Citas', 'Citations')} ({memory.citations.length})</h2>
        {memory.citations.length === 0 ? (
          <p className={styles.dim}>
            {t(
              'Aún nadie ha citado esta entrada. Cuando Claude Code la use durante una tarea, queda registrada aquí con la nota correspondiente.',
              'No one has cited this entry yet. When Claude Code uses it during a task, it gets recorded here with the relevant note.',
            )}
          </p>
        ) : (
          <ul className={styles.citationList}>
            {memory.citations.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/projects/${slug}/board?task=${c.citedInTask.taskNumber}`}
                  className={styles.citationLink}
                >
                  #{c.citedInTask.taskNumber} {c.citedInTask.title}
                </Link>
                <span className={styles.citationMeta}>
                  {t('por', 'by')} {c.citedByUser.name} · {c.createdAt.toLocaleString()}
                </span>
                {c.context && <p className={styles.citationContext}>“{c.context}”</p>}
              </li>
            ))}
          </ul>
        )}
        <RuleDivider variant="ornament" spacing="lg" />
      </section>
    </div>
  );
}

/** Toma la primera oración del markdown como deck. */
function extractDeck(body: string): string | null {
  const stripped = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
  const firstParagraph = stripped.split(/\n\n+/)[0] || '';
  const sentenceEnd = firstParagraph.match(/^([^.!?]{20,180}[.!?])/);
  if (sentenceEnd) return sentenceEnd[1]!.trim();
  if (firstParagraph.length > 30)
    return firstParagraph.slice(0, 180) + (firstParagraph.length > 180 ? '…' : '');
  return null;
}
