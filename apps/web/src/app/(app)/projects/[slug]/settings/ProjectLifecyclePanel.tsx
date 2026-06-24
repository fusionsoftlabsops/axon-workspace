'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ProjectStatus } from '@prisma/client';
import { deleteProjectAction, setProjectStatusAction } from '@/lib/actions/projects';
import { useI18n } from '@/lib/i18n/i18n';

const STATUSES: ProjectStatus[] = ['ACTIVE', 'PAUSED', 'INACTIVE', 'COMPLETED'];

/** Bilingual label + accent color for each lifecycle status. */
function statusMeta(status: ProjectStatus): { es: string; en: string; color: string } {
  switch (status) {
    case 'ACTIVE':
      return { es: 'Activo', en: 'Active', color: 'var(--color-accent)' };
    case 'PAUSED':
      return { es: 'Pausado', en: 'Paused', color: '#b45309' };
    case 'INACTIVE':
      return { es: 'Desactivado', en: 'Inactive', color: 'var(--color-fg-muted)' };
    case 'COMPLETED':
      return { es: 'Completado', en: 'Completed', color: '#15803d' };
  }
}

export function ProjectLifecyclePanel({
  projectSlug,
  projectName,
  currentStatus,
}: {
  projectSlug: string;
  projectName: string;
  currentStatus: ProjectStatus;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ProjectStatus>(currentStatus);

  const [confirmText, setConfirmText] = useState('');
  const [showDelete, setShowDelete] = useState(false);

  function changeStatus(next: ProjectStatus) {
    if (next === status) return;
    setError(null);
    startTransition(async () => {
      const r = await setProjectStatusAction(projectSlug, next);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setStatus(next);
      router.refresh();
    });
  }

  function deleteProject() {
    setError(null);
    startTransition(async () => {
      const r = await deleteProjectAction(projectSlug);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push('/projects');
      router.refresh();
    });
  }

  return (
    <div>
      {/* ---- Status ---- */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          padding: '1rem',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
        }}
      >
        {STATUSES.map((s) => {
          const meta = statusMeta(s);
          const active = s === status;
          return (
            <button
              key={s}
              type="button"
              onClick={() => changeStatus(s)}
              disabled={pending || active}
              aria-pressed={active}
              style={{
                padding: '0.4rem 0.9rem',
                borderRadius: '999px',
                border: `1px solid ${active ? meta.color : 'var(--color-border)'}`,
                background: active ? meta.color : 'transparent',
                color: active ? 'var(--color-accent-fg)' : 'var(--color-fg)',
                fontWeight: active ? 700 : 500,
                cursor: active ? 'default' : 'pointer',
                opacity: pending && !active ? 0.6 : 1,
              }}
            >
              {t(meta.es, meta.en)}
            </button>
          );
        })}
      </div>

      {error && (
        <p
          style={{
            color: 'var(--color-danger)',
            padding: '0.5rem',
            marginTop: '0.75rem',
            background: 'rgba(239,68,68,0.08)',
            borderRadius: '4px',
          }}
        >
          {error}
        </p>
      )}

      {/* ---- Danger zone: delete ---- */}
      <div
        style={{
          marginTop: '2rem',
          padding: '1.25rem',
          border: '1px solid var(--color-danger)',
          borderRadius: '8px',
          background: 'rgba(239,68,68,0.04)',
        }}
      >
        <h3 style={{ margin: '0 0 0.35rem', color: 'var(--color-danger)' }}>
          {t('Eliminar proyecto', 'Delete project')}
        </h3>
        <p style={{ margin: '0 0 1rem', color: 'var(--color-fg-muted)' }}>
          {t(
            'Esta acción es permanente: borra el tablero, las tareas, el vault, el cerebro y los miembros. No se puede deshacer.',
            'This is permanent: it deletes the board, tasks, vault, brain and members. It cannot be undone.',
          )}
        </p>

        {!showDelete ? (
          <button
            type="button"
            onClick={() => setShowDelete(true)}
            disabled={pending}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '4px',
              border: '1px solid var(--color-danger)',
              background: 'transparent',
              color: 'var(--color-danger)',
              fontWeight: 600,
            }}
          >
            {t('Eliminar proyecto', 'Delete project')}
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <label style={{ color: 'var(--color-fg-muted)', fontSize: '0.85rem' }}>
              {t('Escribe', 'Type')} <code>{projectSlug}</code>{' '}
              {t('para confirmar:', 'to confirm:')}
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={projectSlug}
              autoFocus
              style={{
                padding: '0.5rem',
                border: '1px solid var(--color-border)',
                borderRadius: '4px',
                background: 'var(--color-bg)',
                color: 'var(--color-fg)',
                maxWidth: '320px',
              }}
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={deleteProject}
                disabled={pending || confirmText !== projectSlug}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '4px',
                  border: 'none',
                  background: 'var(--color-danger)',
                  color: '#fff',
                  fontWeight: 700,
                  opacity: confirmText === projectSlug && !pending ? 1 : 0.5,
                  cursor: confirmText === projectSlug && !pending ? 'pointer' : 'not-allowed',
                }}
              >
                {pending
                  ? t('Eliminando…', 'Deleting…')
                  : t(`Eliminar "${projectName}"`, `Delete "${projectName}"`)}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDelete(false);
                  setConfirmText('');
                }}
                disabled={pending}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '4px',
                  border: '1px solid var(--color-border)',
                  background: 'transparent',
                  color: 'var(--color-fg)',
                }}
              >
                {t('Cancelar', 'Cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
