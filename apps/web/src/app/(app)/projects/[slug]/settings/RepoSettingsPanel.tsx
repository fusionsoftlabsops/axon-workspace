'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setProjectRepoConfigAction } from '@/lib/actions/repo-config';

export function RepoSettingsPanel({
  projectSlug,
  initial,
}: {
  projectSlug: string;
  initial: { repoPath: string | null; repoUrl: string | null; repoDefaultBranch: string | null };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [repoPath, setRepoPath] = useState(initial.repoPath ?? '');
  const [repoUrl, setRepoUrl] = useState(initial.repoUrl ?? '');
  const [branch, setBranch] = useState(initial.repoDefaultBranch ?? 'main');

  const onSave = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await setProjectRepoConfigAction(projectSlug, {
        repoPath: repoPath.trim() || null,
        repoUrl: repoUrl.trim() || null,
        repoDefaultBranch: branch.trim() || 'main',
      });
      if (!res.ok) {
        setError(res.error ?? 'no se pudo guardar');
        return;
      }
      setSuccess('Configuración guardada');
      router.refresh();
    });
  };

  return (
    <form
      onSubmit={onSave}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        maxWidth: 600,
        padding: '1.5rem',
        border: '1px solid var(--rule)',
        background: 'var(--paper-warm)',
        marginTop: '1rem',
      }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <span style={{
          fontFamily: 'var(--font-ui)',
          fontSize: '0.72rem',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--color-fg-muted)',
        }}>
          Ruta absoluta del repo (server-side)
        </span>
        <input
          type="text"
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          placeholder="C:\Users\Manuel\Documents\Proyectos\mi-app"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.85rem',
            background: 'transparent',
            border: 0,
            borderBottom: '1px solid var(--rule)',
            padding: '0.25rem 0',
            color: 'var(--ink)',
          }}
        />
        <span style={{ fontSize: '0.75rem', color: 'var(--color-fg-muted)', fontStyle: 'italic' }}>
          Debe existir en el filesystem del server. Solo lectura.
        </span>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <span style={{
          fontFamily: 'var(--font-ui)',
          fontSize: '0.72rem',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--color-fg-muted)',
        }}>
          URL del repo <span style={{ textTransform: 'none', letterSpacing: 0, fontStyle: 'italic' }}>(opcional, para mostrar links)</span>
        </span>
        <input
          type="url"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/usuario/repo"
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: '0.9rem',
            background: 'transparent',
            border: 0,
            borderBottom: '1px solid var(--rule)',
            padding: '0.25rem 0',
            color: 'var(--ink)',
          }}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <span style={{
          fontFamily: 'var(--font-ui)',
          fontSize: '0.72rem',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--color-fg-muted)',
        }}>
          Branch por defecto
        </span>
        <input
          type="text"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="main"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.85rem',
            background: 'transparent',
            border: 0,
            borderBottom: '1px solid var(--rule)',
            padding: '0.25rem 0',
            color: 'var(--ink)',
            maxWidth: 200,
          }}
        />
      </label>

      {error && <p style={{ color: 'var(--accent-ink)', fontSize: '0.85rem', margin: 0 }}>{error}</p>}
      {success && <p style={{ color: 'var(--ink)', fontSize: '0.85rem', fontStyle: 'italic', margin: 0 }}>{success}</p>}

      <button
        type="submit"
        disabled={pending}
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: '0.78rem',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          padding: '0.6rem 1rem',
          background: 'var(--ink)',
          color: 'var(--paper)',
          border: 0,
          cursor: pending ? 'not-allowed' : 'pointer',
          alignSelf: 'flex-start',
        }}
      >
        {pending ? 'Guardando…' : 'Guardar'}
      </button>
    </form>
  );
}
