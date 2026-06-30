'use client';

import { useState, useTransition } from 'react';
import { useI18n } from '@/lib/i18n/i18n';
import { captureMemoryAction } from '@/lib/actions/brain';
import styles from './brain.module.scss';

const TYPE_VALUES = [
  'NOTE',
  'DECISION',
  'GOTCHA',
  'PATTERN',
  'ANTIPATTERN',
  'RUNBOOK',
  'GLOSSARY',
] as const;

type MemType = (typeof TYPE_VALUES)[number];

function typeOptions(
  t: <T>(es: T, en: T) => T,
): { value: MemType; label: string }[] {
  return [
    { value: 'NOTE', label: t('Nota', 'Note') },
    { value: 'DECISION', label: t('Decisión técnica', 'Technical decision') },
    { value: 'GOTCHA', label: t('Trampa / gotcha', 'Gotcha') },
    { value: 'PATTERN', label: t('Patrón validado', 'Validated pattern') },
    { value: 'ANTIPATTERN', label: t('Anti-patrón', 'Anti-pattern') },
    { value: 'RUNBOOK', label: t('Runbook (cómo hacer X)', 'Runbook (how to do X)') },
    { value: 'GLOSSARY', label: t('Glosario', 'Glossary') },
  ];
}

export function NewMemoryForm({
  projectSlug,
  onCreated,
}: {
  projectSlug: string;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const TYPE_OPTIONS = typeOptions(t);
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
      <h3>{t('Nueva memoria', 'New memory')}</h3>
      <div className={styles.formGrid}>
        <label>
          <span>{t('Tipo', 'Type')}</span>
          <select name="type" value={type} onChange={(e) => setType(e.target.value as MemType)}>
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('Destino', 'Destination')}</span>
          <select name="scope" value={scope} onChange={(e) => setScope(e.target.value as 'LOCAL' | 'PROJECT')}>
            <option value="LOCAL">{t('Mi cerebro local', 'My local brain')}</option>
            <option value="PROJECT">{t('Publicar al principal directamente', 'Publish to main directly')}</option>
          </select>
        </label>
        <label>
          <span>{t('Tarea origen (opcional, número)', 'Source task (optional, number)')}</span>
          <input
            type="number"
            name="sourceTaskNumber"
            min={1}
            value={taskNum}
            onChange={(e) => setTaskNum(e.target.value)}
            placeholder="42"
          />
        </label>
        <label>
          <span>{t('Tags (separados por coma, máx 8)', 'Tags (comma-separated, max 8)')}</span>
          <input
            type="text"
            name="tags"
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="auth, gotcha, deploy"
          />
        </label>
      </div>
      <label>
        <span>{t('Título', 'Title')}</span>
        <input
          type="text"
          name="title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('Resumen breve y descriptivo', 'Short, descriptive summary')}
        />
      </label>
      <label>
        <span>{t('Cuerpo (markdown)', 'Body (markdown)')}</span>
        <textarea
          name="body"
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          placeholder={t(
            '## Qué aprendí\n\n...\n\n## Cómo aplicarlo\n\n...',
            '## What I learned\n\n...\n\n## How to apply it\n\n...',
          )}
        />
      </label>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.formActions}>
        <button type="submit" disabled={pending || !title || !body}>
          {pending ? t('Guardando…', 'Saving…') : t('Capturar memoria', 'Capture memory')}
        </button>
      </div>
    </form>
  );
}
