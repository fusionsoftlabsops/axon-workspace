'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  deprecateMemoryAction,
  publishMemoryAction,
  supersedeMemoryAction,
} from '@/lib/actions/brain';
import styles from './detail.module.scss';

type MemType = 'DECISION' | 'GOTCHA' | 'PATTERN' | 'ANTIPATTERN' | 'RUNBOOK' | 'GLOSSARY' | 'NOTE';

const TYPE_OPTIONS: { value: MemType; label: string }[] = [
  { value: 'DECISION', label: 'Decisión' },
  { value: 'GOTCHA', label: 'Trampa' },
  { value: 'PATTERN', label: 'Patrón' },
  { value: 'ANTIPATTERN', label: 'Anti-patrón' },
  { value: 'RUNBOOK', label: 'Runbook' },
  { value: 'GLOSSARY', label: 'Glosario' },
  { value: 'NOTE', label: 'Nota' },
];

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
    if (!confirm('¿Marcar esta memoria como deprecated?')) return;
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
            ↑ Publicar al cerebro principal
          </button>
        )}
        <button
          onClick={() => setShowSupersede((v) => !v)}
          disabled={pending}
          className={styles.btnSecondary}
        >
          {showSupersede ? 'Cancelar' : '↻ Reemplazar con nueva versión'}
        </button>
        <button onClick={deprecate} disabled={pending} className={styles.btnDanger}>
          Deprecar
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {showSupersede && (
        <form onSubmit={supersede} className={styles.supersedeForm}>
          <p className={styles.dim}>
            Crea una nueva memoria que reemplace a esta. La actual queda como{' '}
            <code>SUPERSEDED</code> con linaje preservado.
          </p>
          <div className={styles.grid2}>
            <label>
              <span>Tipo</span>
              <select value={type} onChange={(e) => setType(e.target.value as MemType)}>
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Tags (coma)</span>
              <input value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} />
            </label>
          </div>
          <label>
            <span>Nuevo título</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label>
            <span>Nuevo cuerpo</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} required />
          </label>
          <div className={styles.formActions}>
            <button type="submit" disabled={pending} className={styles.btnPrimary}>
              {pending ? 'Reemplazando…' : 'Crear reemplazo'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
