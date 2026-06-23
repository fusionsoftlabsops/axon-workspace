'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useI18n } from '@/lib/i18n/i18n';
import { Eyebrow, Tag } from '@/components/ui';
import {
  deprecateMemoryAction,
  publishMemoryAction,
} from '@/lib/actions/brain';
import styles from './brain.module.scss';

export interface MemoryView {
  id: string;
  scope: 'LOCAL' | 'PROJECT';
  type:
    | 'DECISION'
    | 'GOTCHA'
    | 'PATTERN'
    | 'ANTIPATTERN'
    | 'RUNBOOK'
    | 'GLOSSARY'
    | 'NOTE';
  title: string;
  body: string;
  tags: string[];
  status: 'ACTIVE' | 'DEPRECATED' | 'SUPERSEDED';
  authorName: string;
  ownerUserId: string | null;
  sourceTaskNumber: number | null;
  citationCount: number;
  lastCitedAt: string | null;
  updatedAt: string;
}

function typeLabel(t: <T>(es: T, en: T) => T): Record<MemoryView['type'], string> {
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

const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 30 * 6;

export function MemoryCard({
  projectSlug,
  memory,
  currentUserId,
  isOwner,
  onTagClick,
  index = 0,
}: {
  projectSlug: string;
  memory: MemoryView;
  currentUserId: string;
  isOwner: boolean;
  onTagClick: (tag: string) => void;
  index?: number;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const TYPE_LABEL = typeLabel(t);

  const canPublish =
    memory.scope === 'LOCAL' &&
    (memory.ownerUserId === currentUserId || isOwner) &&
    memory.status === 'ACTIVE';
  const canDeprecate =
    (memory.ownerUserId === currentUserId || isOwner) && memory.status === 'ACTIVE';

  const lastTouchMs = new Date(memory.lastCitedAt ?? memory.updatedAt).getTime();
  const isStale =
    memory.scope === 'PROJECT' && Date.now() - lastTouchMs > SIX_MONTHS_MS;

  function publish() {
    startTransition(async () => {
      const r = await publishMemoryAction(memory.id);
      if (!r.ok) alert(r.error);
      else router.refresh();
    });
  }

  function deprecate() {
    if (
      !confirm(
        t(
          `¿Deprecar la memoria "${memory.title}"? Queda visible pero marcada.`,
          `Deprecate the memory "${memory.title}"? It stays visible but flagged.`,
        ),
      )
    )
      return;
    startTransition(async () => {
      const r = await deprecateMemoryAction(memory.id);
      if (!r.ok) alert(r.error);
      else router.refresh();
    });
  }

  const preview = stripMarkdown(memory.body);

  return (
    <article
      className={`${styles.card} ${memory.status !== 'ACTIVE' ? styles.cardDimmed : ''}`}
      style={{ '--index': Math.min(index, 12) } as React.CSSProperties}
    >
      <aside className={styles.cardAside}>
        <Eyebrow tone="accent" as="div">
          {TYPE_LABEL[memory.type]}
        </Eyebrow>
        <span
          className={
            memory.scope === 'PROJECT' ? styles.scopeStampProject : styles.scopeStampLocal
          }
        >
          {memory.scope === 'PROJECT' ? t('Principal', 'Main') : t('Local', 'Local')}
        </span>
        {memory.status === 'DEPRECATED' && (
          <span className={styles.statusStamp}>Deprecated</span>
        )}
        {memory.status === 'SUPERSEDED' && (
          <span className={styles.statusStamp}>Superseded</span>
        )}
        {isStale && <span className={styles.staleStamp}>Stale</span>}
        <div className={styles.metaLine}>
          <span>{memory.authorName}</span>
          {memory.sourceTaskNumber && (
            <>
              {' · '}
              <Link href={`/projects/${projectSlug}/board?task=${memory.sourceTaskNumber}`}>
                #{memory.sourceTaskNumber}
              </Link>
            </>
          )}
          {memory.citationCount > 0 && (
            <span>
              {' · '}
              {memory.citationCount}{' '}
              {memory.citationCount === 1 ? t('cita', 'citation') : t('citas', 'citations')}
            </span>
          )}
        </div>
      </aside>

      <div className={styles.cardMain}>
        <Link href={`/projects/${projectSlug}/brain/${memory.id}`} className={styles.cardTitleLink}>
          <h3 className={styles.cardTitle}>{memory.title}</h3>
        </Link>

        <p className={styles.cardBody}>{preview}</p>

        {memory.tags.length > 0 && (
          <div className={styles.tags}>
            {memory.tags.map((t) => (
              <Tag key={t} tone="subtle" onClick={() => onTagClick(t)}>
                {t}
              </Tag>
            ))}
          </div>
        )}
      </div>

      <div className={styles.cardActions}>
        <Link href={`/projects/${projectSlug}/brain/${memory.id}`} className={styles.detailLink}>
          {t('Leer', 'Read')} ↗
        </Link>
        {canPublish && (
          <button onClick={publish} disabled={pending} className={styles.publishBtn}>
            ↑ {t('Publicar', 'Publish')}
          </button>
        )}
        {canDeprecate && (
          <button onClick={deprecate} disabled={pending} className={styles.deprecateBtn}>
            {t('Deprecar', 'Deprecate')}
          </button>
        )}
      </div>
    </article>
  );
}

/** Limpia el body markdown para mostrarlo como preview de texto plano. */
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '')          // bloques de código
    .replace(/`([^`]+)`/g, '$1')              // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1')        // bold
    .replace(/\*([^*]+)\*/g, '$1')            // italic
    .replace(/#{1,6}\s+/g, '')                // headings
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // links
    .replace(/^\s*[-*+]\s+/gm, '')            // bullets
    .replace(/\n{2,}/g, ' · ')                // párrafos a separadores
    .replace(/\n/g, ' ')
    .trim();
}
