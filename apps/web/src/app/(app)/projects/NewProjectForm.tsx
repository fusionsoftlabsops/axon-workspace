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
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/projects/${finalSlug}/board`);
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
      {error && <p className={styles.error}>{error}</p>}
      <button type="submit" disabled={pending || name.length === 0}>
        {pending ? t('Creando…', 'Creating…') : t('Crear proyecto', 'Create project')}
      </button>
    </form>
  );
}
