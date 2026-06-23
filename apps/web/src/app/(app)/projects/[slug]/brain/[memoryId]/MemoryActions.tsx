'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useI18n } from '@/lib/i18n/i18n';
import {
  deprecateMemoryAction,
  publishMemoryAction,
  supersedeMemoryAction,
} from '@/lib/actions/brain';
import styles from './detail.module.scss';

type MemType = 'DECISION' | 'GOTCHA' | 'PATTERN' | 'ANTIPATTERN' | 'RUNBOOK' | 'GLOSSARY' | 'NOTE';

function typeOptions(t: <T>(es: T, en: T) => T): { value: MemType; label: string }[] {
  return [
    { value: 'DECISION', label: t('Decisión', 'Decision') },
    { value: 'GOTCHA', label: t('Trampa', 'Gotcha') },
    { value: 'PATTERN', label: t('Patrón', 'Pattern') },
    { value: 'ANTIPATTERN', label: t('Anti-patrón', 'Anti-pattern') },
    { value: 'RUNBOOK', label: t('Runbook', 'Runbook') },
    { value: 'GLOSSARY', label: t('Glosario', 'Glossary') },
    { value: 'NOTE', label: t('Nota', 'Note') },
  ];
}

export function MemoryActions({
  projectSlug,
  memoryId,
  scope,
  currentBody,
  currentTitle,
  currentType,
  currentTags,
}: {
  projectSlug: string;
  memoryId: string;
  scope: 'LOCAL' | 'PROJECT';
  currentBody: string;
  currentTitle: string;
  currentType: MemType;
  currentTags: string[];
}) {
  const { t } = useI18n();
  const TYPE_OPTIONS = typeOptions(t);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showSupersede, setShowSupersede] = useState(false);
  const [body, setBody] = useState(currentBody);
  const [title, setTitle] = useState(currentTitle);
  const [type, setType] = useState<MemType>(currentType);
  const [tagsRaw, setTagsRaw] = useState(currentTags.join(', '));
  const [error, setError] = useState<string | null>(null);

  function publish() {
    setError(null);
    startTransition(async () => {
      const r = await publishMemoryAction(memoryId);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function deprecate() {
    if (!confirm(t('¿Marcar esta memoria como deprecated?', 'Mark this memory as deprecated?'))) return;
    setError(null);
    startTransition(async () => {
      const r = await deprecateMemoryAction(memoryId);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function supersede(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await supersedeMemoryAction(memoryId, {
        title: title !== currentTitle ? title : undefined,
        body,
        type: type !== currentType ? type : undefined,
        tags: tagsRaw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 8),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (r.data?.newMemoryId) {
        router.push(`/projects/${projectSlug}/brain/${r.data.newMemoryId}`);
        router.refresh();
      }
    });
  }

  return (
    <div className={styles.actions}>
      <div className={styles.actionsRow}>
        {scope === 'LOCAL' && (
          <button onClick={publish} disabled={pending} className={styles.btnPrimary}>
            ↑ {t('Publicar al cerebro principal', 'Publish to the main brain')}
          </button>
        )}
        <button
          onClick={() => setShowSupersede((v) => !v)}
          disabled={pending}
          className={styles.btnSecondary}
        >
          {showSupersede ? t('Cancelar', 'Cancel') : t('↻ Reemplazar con nueva versión', '↻ Replace with new version')}
        </button>
        <button onClick={deprecate} disabled={pending} className={styles.btnDanger}>
          {t('Deprecar', 'Deprecate')}
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {showSupersede && (
        <form onSubmit={supersede} className={styles.supersedeForm}>
          <p className={styles.dim}>
            {t('Crea una nueva memoria que reemplace a esta. La actual queda como', 'Create a new memory that supersedes this one. The current one becomes')}{' '}
            <code>SUPERSEDED</code> {t('con linaje preservado.', 'with its lineage preserved.')}
          </p>
          <div className={styles.grid2}>
            <label>
              <span>{t('Tipo', 'Type')}</span>
              <select value={type} onChange={(e) => setType(e.target.value as MemType)}>
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('Tags (coma)', 'Tags (comma)')}</span>
              <input value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} />
            </label>
          </div>
          <label>
            <span>{t('Nuevo título', 'New title')}</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label>
            <span>{t('Nuevo cuerpo', 'New body')}</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} required />
          </label>
          <div className={styles.formActions}>
            <button type="submit" disabled={pending} className={styles.btnPrimary}>
              {pending ? t('Reemplazando…', 'Replacing…') : t('Crear reemplazo', 'Create replacement')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
