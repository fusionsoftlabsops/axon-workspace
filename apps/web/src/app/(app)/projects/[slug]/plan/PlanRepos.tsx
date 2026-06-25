'use client';

import { useEffect, useState } from 'react';
import { Badge, Button } from '@/components/ui';
import { useI18n } from '@/lib/i18n/i18n';
import {
  getReposSectionAction,
  createRepoOnGithubAction,
  linkExistingRepoAction,
  updateProjectRepoAction,
  removeProjectRepoAction,
  verifyRepoAccessAction,
  type ReposSection,
  type ProjectRepoView,
} from '@/lib/actions/repos';
import styles from './plan.module.scss';

const KINDS = ['backend', 'frontend', 'infra', 'mobile', 'shared', 'other'];

export function PlanRepos({ slug, canWrite }: { slug: string; canWrite: boolean }) {
  const { t } = useI18n();
  const [section, setSection] = useState<ReposSection | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // per-row transient inputs
  const [linkUrl, setLinkUrl] = useState<Record<string, string>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [add, setAdd] = useState({ name: '', url: '', kind: 'other' });

  useEffect(() => {
    getReposSectionAction(slug).then((r) => {
      if (r.ok && r.data) setSection(r.data);
    });
  }, [slug]);

  function apply(key: string, p: Promise<{ ok: boolean; data?: ReposSection; error?: string }>) {
    setBusy(key);
    setError(null);
    return p
      .then((r) => {
        if (!r.ok) setError(r.error ?? t('Acción fallida', 'Action failed'));
        else if (r.data) setSection(r.data);
      })
      .finally(() => setBusy(null));
  }

  if (!section) {
    return (
      <div>
        <h3>{t('Repositorios', 'Repositories')}</h3>
        <p className={styles.repoReason}>{t('Cargando…', 'Loading…')}</p>
      </div>
    );
  }

  const existingNames = new Set(section.repos.map((r) => r.name.toLowerCase()));
  const pendingSuggested = section.suggested.filter((s) => !existingNames.has(s.name.toLowerCase()));

  return (
    <div>
      <h3>{t('Repositorios', 'Repositories')}</h3>
      {!section.githubConfigured && (
        <p className={styles.repoReason}>
          {t(
            'GitHub no está configurado (GITHUB_TOKEN/GITHUB_ORG): puedes vincular URLs y editar rutas, pero crear y verificar acceso están deshabilitados.',
            'GitHub is not configured (GITHUB_TOKEN/GITHUB_ORG): you can link URLs and edit paths, but creating and access checks are disabled.',
          )}
        </p>
      )}

      {/* ---- Project repos (created/linked) ---- */}
      {section.repos.length > 0 && (
        <div className={styles.repoList}>
          {section.repos.map((r) => (
            <RepoRow
              key={r.id}
              repo={r}
              members={section.members}
              canWrite={canWrite}
              githubConfigured={section.githubConfigured}
              busy={busy}
              editing={editId === r.id}
              onToggleEdit={() => setEditId(editId === r.id ? null : r.id)}
              onVerify={() => apply(`verify:${r.id}`, verifyRepoAccessAction(slug, r.id))}
              onSave={(patch) => {
                apply(`save:${r.id}`, updateProjectRepoAction(slug, r.id, patch));
                setEditId(null);
              }}
              onRemove={() => {
                if (confirm(t('¿Quitar este repo del proyecto?', 'Remove this repo from the project?')))
                  apply(`rm:${r.id}`, removeProjectRepoAction(slug, r.id));
              }}
              t={t}
            />
          ))}
        </div>
      )}

      {/* ---- AI-suggested repos not yet created/linked ---- */}
      {pendingSuggested.length > 0 && canWrite && (
        <>
          <p className={styles.repoSubhead}>{t('Sugeridos por la IA', 'AI-suggested')}</p>
          <div className={styles.repoList}>
            {pendingSuggested.map((s) => (
              <div key={s.name} className={styles.repoCard}>
                <div className={styles.repoName}>
                  {s.name} <Badge tone="neutral">{s.kind}</Badge>
                </div>
                {s.stack && <p className={styles.repoReason}>{s.stack}</p>}
                {s.reason && <p className={styles.repoReason}>{s.reason}</p>}
                <div className={styles.rowActions}>
                  {section.githubConfigured && (
                    <button
                      type="button"
                      className={styles.miniBtn}
                      disabled={!!busy}
                      onClick={() =>
                        apply(
                          `create:${s.name}`,
                          createRepoOnGithubAction(slug, { name: s.name, kind: s.kind, description: s.reason }),
                        )
                      }
                    >
                      {busy === `create:${s.name}` ? t('Creando…', 'Creating…') : t('⊕ Crear en GitHub', '⊕ Create on GitHub')}
                    </button>
                  )}
                  <input
                    className={styles.linkInput}
                    type="url"
                    placeholder={t('o pega URL existente…', 'or paste existing URL…')}
                    value={linkUrl[s.name] ?? ''}
                    onChange={(e) => setLinkUrl({ ...linkUrl, [s.name]: e.target.value })}
                  />
                  <button
                    type="button"
                    className={styles.miniBtn}
                    disabled={!!busy || !(linkUrl[s.name] ?? '').trim()}
                    onClick={() =>
                      apply(
                        `link:${s.name}`,
                        linkExistingRepoAction(slug, { name: s.name, kind: s.kind, url: linkUrl[s.name] ?? '' }),
                      )
                    }
                  >
                    {t('Vincular', 'Link')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ---- Manual add ---- */}
      {canWrite && (
        <div className={styles.repoAdd}>
          {addOpen ? (
            <div className={styles.repoCard}>
              <div className={styles.fieldGrid}>
                <input
                  className={styles.editInput}
                  placeholder={t('nombre', 'name')}
                  value={add.name}
                  onChange={(e) => setAdd({ ...add, name: e.target.value })}
                />
                <input
                  className={styles.editInput}
                  placeholder="https://github.com/org/repo"
                  value={add.url}
                  onChange={(e) => setAdd({ ...add, url: e.target.value })}
                />
                <select
                  className={styles.editSelect}
                  value={add.kind}
                  onChange={(e) => setAdd({ ...add, kind: e.target.value })}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.rowActions}>
                <Button
                  variant="primary"
                  disabled={!!busy || !add.name.trim() || !add.url.trim()}
                  onClick={() =>
                    apply('add', linkExistingRepoAction(slug, add)).then(() => {
                      setAdd({ name: '', url: '', kind: 'other' });
                      setAddOpen(false);
                    })
                  }
                >
                  {t('Añadir', 'Add')}
                </Button>
                <Button variant="secondary" onClick={() => setAddOpen(false)}>
                  {t('Cancelar', 'Cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <button type="button" className={styles.miniBtn} onClick={() => setAddOpen(true)}>
              + {t('Añadir repo existente', 'Add existing repo')}
            </button>
          )}
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

function RepoRow({
  repo,
  members,
  canWrite,
  githubConfigured,
  busy,
  editing,
  onToggleEdit,
  onVerify,
  onSave,
  onRemove,
  t,
}: {
  repo: ProjectRepoView;
  members: ReposSection['members'];
  canWrite: boolean;
  githubConfigured: boolean;
  busy: string | null;
  editing: boolean;
  onToggleEdit: () => void;
  onVerify: () => void;
  onSave: (patch: { kind?: string; url?: string; repoPath?: string }) => void;
  onRemove: () => void;
  t: <T>(es: T, en: T) => T;
}) {
  const [draft, setDraft] = useState({ kind: repo.kind, url: repo.url ?? '', repoPath: repo.repoPath ?? '' });

  return (
    <div className={styles.repoCard}>
      <div className={styles.repoName}>
        {repo.url ? (
          <a href={repo.url} target="_blank" rel="noreferrer">
            {repo.name}
          </a>
        ) : (
          repo.name
        )}{' '}
        <Badge tone="neutral">{repo.kind}</Badge>
        {!repo.repoPath && <Badge tone="accent">{t('sin ruta local', 'no local path')}</Badge>}
      </div>
      {repo.githubFullName && <p className={styles.repoReason}>{repo.githubFullName}</p>}

      {editing ? (
        <div className={styles.editForm}>
          <select
            className={styles.editSelect}
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input
            className={styles.editInput}
            placeholder="https://github.com/org/repo"
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          />
          <input
            className={styles.editInput}
            placeholder={t('ruta local en el server (para leer archivos)', 'server local path (to read files)')}
            value={draft.repoPath}
            onChange={(e) => setDraft({ ...draft, repoPath: e.target.value })}
          />
          <div className={styles.rowActions}>
            <Button variant="primary" disabled={!!busy} onClick={() => onSave(draft)}>
              {t('Guardar', 'Save')}
            </Button>
            <Button variant="secondary" onClick={onToggleEdit}>
              {t('Cancelar', 'Cancel')}
            </Button>
          </div>
        </div>
      ) : (
        canWrite && (
          <div className={styles.rowActions}>
            {githubConfigured && (
              <button type="button" className={styles.miniBtn} disabled={!!busy} onClick={onVerify}>
                {busy === `verify:${repo.id}` ? t('Verificando…', 'Checking…') : t('Verificar acceso', 'Check access')}
              </button>
            )}
            <button type="button" className={styles.miniBtn} onClick={onToggleEdit}>
              ✎ {t('Configurar', 'Configure')}
            </button>
            <button type="button" className={`${styles.miniBtn} ${styles.miniDanger}`} onClick={onRemove}>
              🗑 {t('Quitar', 'Remove')}
            </button>
          </div>
        )
      )}

      {/* Access matrix */}
      {repo.access && repo.access.length > 0 && (
        <ul className={styles.accessList}>
          {repo.access.map((a) => (
            <li key={a.userId} className={styles.accessRow}>
              <span className={styles.accessWho}>
                {a.name}
                {a.login && <span className={styles.accessLogin}>@{a.login}</span>}
              </span>
              {a.hasAccess === null ? (
                <span className={styles.accessUnknown}>{t('sin handle', 'no handle')}</span>
              ) : a.hasAccess ? (
                <span className={styles.accessYes}>✓ {a.permission}</span>
              ) : (
                <span className={styles.accessNo}>✗ {t('sin acceso', 'no access')}</span>
              )}
            </li>
          ))}
          {repo.githubFullName && (
            <li className={styles.accessRow}>
              <a
                className={styles.accessInvite}
                href={`https://github.com/${repo.githubFullName}/settings/access`}
                target="_blank"
                rel="noreferrer"
              >
                {t('Gestionar acceso en GitHub →', 'Manage access on GitHub →')}
              </a>
            </li>
          )}
        </ul>
      )}
      {repo.accessCheckedAt && (
        <p className={styles.repoReason}>
          {t('Verificado', 'Checked')}: {new Date(repo.accessCheckedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
