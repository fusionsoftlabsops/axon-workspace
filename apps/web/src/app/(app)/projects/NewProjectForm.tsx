'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createProjectAction } from '@/lib/actions/projects';
import styles from './page.module.scss';
import { useI18n } from '@/lib/i18n/i18n';

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function NewProjectForm() {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [runtime, setRuntime] = useState<'CLOUD' | 'LOCAL'>('CLOUD');
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const finalSlug = slug || slugify(name);
    startTransition(async () => {
      const res = await createProjectAction({
        slug: finalSlug,
        name,
        description: description || undefined,
        runtime,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // New projects go to the AI-assisted planning stage first (skippable there).
      router.push(`/projects/${finalSlug}/plan`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className={styles.newForm}>
      <input
        type="text"
        placeholder={t('Nombre del proyecto', 'Project name')}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (!slug) setSlug(slugify(e.target.value));
        }}
        required
      />
      <input
        type="text"
        placeholder={t('slug (auto)', 'slug (auto)')}
        value={slug}
        onChange={(e) => setSlug(slugify(e.target.value))}
        pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
      />
      <textarea
        placeholder={t('Descripción (opcional)', 'Description (optional)')}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
      />
      <fieldset className={styles.runtimeChoice} data-testid="runtime-choice">
        <legend>{t('¿Dónde corren los agentes?', 'Where do the agents run?')}</legend>
        <label data-selected={runtime === 'CLOUD'}>
          <input
            type="radio"
            name="runtime"
            value="CLOUD"
            checked={runtime === 'CLOUD'}
            onChange={() => setRuntime('CLOUD')}
          />
          <span className={styles.runtimeTitle}>☁️ {t('Nube · 24/7', 'Cloud · 24/7')}</span>
          <span className={styles.runtimeHint}>
            {t(
              'El equipo de agentes trabaja solo en el servidor, siempre encendido.',
              'The agent team works on the server, always on.',
            )}
          </span>
        </label>
        <label data-selected={runtime === 'LOCAL'} data-testid="runtime-local">
          <input
            type="radio"
            name="runtime"
            value="LOCAL"
            checked={runtime === 'LOCAL'}
            onChange={() => setRuntime('LOCAL')}
          />
          <span className={styles.runtimeTitle}>💻 {t('Local · tu Claude Code', 'Local · your Claude Code')}</span>
          <span className={styles.runtimeHint}>
            {t(
              'Los 9 agentes corren en tu Claude Code (herramientas reales, sin límites de contexto). Corre solo con tu PC encendida.',
              'The 9 agents run in your Claude Code (real tools, no context limits). Runs only while your PC is on.',
            )}
          </span>
        </label>
      </fieldset>
      {error && <p className={styles.error}>{error}</p>}
      <button type="submit" disabled={pending || name.length === 0}>
        {pending ? t('Creando…', 'Creating…') : t('Crear proyecto', 'Create project')}
      </button>
    </form>
  );
}
