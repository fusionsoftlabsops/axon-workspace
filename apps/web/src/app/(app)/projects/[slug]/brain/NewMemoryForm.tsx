'use client';

import { useState, useTransition } from 'react';
import { captureMemoryAction } from '@/lib/actions/brain';
import styles from './brain.module.scss';

const TYPE_OPTIONS = [
  { value: 'NOTE', label: 'Nota' },
  { value: 'DECISION', label: 'Decisión técnica' },
  { value: 'GOTCHA', label: 'Trampa / gotcha' },
  { value: 'PATTERN', label: 'Patrón validado' },
  { value: 'ANTIPATTERN', label: 'Anti-patrón' },
  { value: 'RUNBOOK', label: 'Runbook (cómo hacer X)' },
  { value: 'GLOSSARY', label: 'Glosario' },
] as const;

type MemType = (typeof TYPE_OPTIONS)[number]['value'];

export function NewMemoryForm({
  projectSlug,
  onCreated,
}: {
  projectSlug: string;
  onCreated: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<MemType>('NOTE');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tagsRaw, setTagsRaw] = useState('');
  const [taskNum, setTaskNum] = useState('');
  const [scope, setScope] = useState<'LOCAL' | 'PROJECT'>('LOCAL');
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await captureMemoryAction(projectSlug, {
        type,
        title: title.trim(),
        body: body.trim(),
        tags: tagsRaw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 8),
        scope,
        sourceTaskNumber: taskNum ? parseInt(taskNum, 10) : undefined,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setTitle('');
      setBody('');
      setTagsRaw('');
      setTaskNum('');
      onCreated();
    });
  }

  return (
    <form className={styles.newForm} onSubmit={submit}>
      <h3>Nueva memoria</h3>
      <div className={styles.formGrid}>
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
          <span>Destino</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as 'LOCAL' | 'PROJECT')}>
            <option value="LOCAL">Mi cerebro local</option>
            <option value="PROJECT">Publicar al principal directamente</option>
          </select>
        </label>
        <label>
          <span>Tarea origen (opcional, número)</span>
          <input
            type="number"
            min={1}
            value={taskNum}
            onChange={(e) => setTaskNum(e.target.value)}
            placeholder="42"
          />
        </label>
        <label>
          <span>Tags (separados por coma, máx 8)</span>
          <input
            type="text"
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="auth, gotcha, deploy"
          />
        </label>
      </div>
      <label>
        <span>Título</span>
        <input
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Resumen breve y descriptivo"
        />
      </label>
      <label>
        <span>Cuerpo (markdown)</span>
        <textarea
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          placeholder={'## Qué aprendí\n\n...\n\n## Cómo aplicarlo\n\n...'}
        />
      </label>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.formActions}>
        <button type="submit" disabled={pending || !title || !body}>
          {pending ? 'Guardando…' : 'Capturar memoria'}
        </button>
      </div>
    </form>
  );
}
