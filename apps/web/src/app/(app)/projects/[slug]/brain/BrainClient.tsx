'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useI18n } from '@/lib/i18n/i18n';
import { Eyebrow, RuleDivider, Stat } from '@/components/ui';
import { MemoryCard, type MemoryView } from './MemoryCard';
import { NewMemoryForm } from './NewMemoryForm';
import styles from './brain.module.scss';

type Tab = 'project' | 'local' | 'audit';

const TYPE_OPTIONS = [
  'DECISION',
  'GOTCHA',
  'PATTERN',
  'ANTIPATTERN',
  'RUNBOOK',
  'GLOSSARY',
  'NOTE',
] as const;

interface Stats {
  project: number;
  local: number;
  topCited: Array<{ id: string; title: string; citationCount: number }>;
  stale: number;
  orphans: number;
}

export function BrainClient({
  projectSlug,
  isOwner,
  currentUserId,
  activeTab,
  query,
  typeFilter,
  tagFilter,
  memories,
  stats,
  staleActive,
  orphansActive,
  auditByAuthor,
}: {
  projectSlug: string;
  isOwner: boolean;
  currentUserId: string;
  activeTab: Tab;
  query: string;
  typeFilter: string | null;
  tagFilter: string | null;
  memories: MemoryView[];
  stats: Stats;
  staleActive: boolean;
  orphansActive: boolean;
  auditByAuthor: Array<{
    userId: string;
    name: string;
    email: string;
    role: string;
    local: number;
    project: number;
    cited: number;
    stale: number;
  }> | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [showNew, setShowNew] = useState(false);
  const [searchValue, setSearchValue] = useState(query);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    startTransition(() => {
      router.push(`/projects/${projectSlug}/brain?${next.toString()}`);
    });
  }

  function setTab(tab: Tab) {
    setParam('tab', tab);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setParam('q', searchValue.trim() || null);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <Eyebrow ornament="section" tone="muted">
            {t('Bitácora compartida del proyecto', 'Shared project logbook')}
          </Eyebrow>
          <h1 className={styles.title}>{t('El cerebro', 'The brain')}</h1>
          <p className={styles.subtitle}>
            {t(
              'Conocimiento curado: decisiones, trampas, patrones y runbooks. Lo que se publica al principal queda visible para todo el equipo.',
              'Curated knowledge: decisions, gotchas, patterns and runbooks. Anything published to the main brain stays visible to the whole team.',
            )}
          </p>
        </div>
        <button onClick={() => setShowNew((v) => !v)} className={styles.newBtn}>
          {showNew ? t('Cancelar', 'Cancel') : t('+ Nueva entrada', '+ New entry')}
        </button>
      </header>

      <div aria-hidden className={styles['masthead-rule']} />

      <div className={styles.statsStrip}>
        <Stat value={stats.project} label={t('en cerebro principal', 'in main brain')} />
        <Stat value={stats.local} label={t('en tu local', 'in your local')} />
        <Stat
          value={stats.stale}
          label={t('stale (>6 meses)', 'stale (>6 months)')}
          hint={t('sin uso reciente', 'no recent use')}
          active={staleActive}
          trend={stats.stale > 0 ? 'warn' : 'flat'}
          onClick={() => setParam('stale', staleActive ? null : '1')}
        />
        <Stat
          value={stats.orphans}
          label={t('huérfanas', 'orphans')}
          hint={t('cero citas', 'zero citations')}
          active={orphansActive}
          onClick={() => setParam('orphans', orphansActive ? null : '1')}
        />
        {stats.topCited.length > 0 && (
          <div className={styles.topCited}>
            <span className={styles.topCitedLabel}>{t('Más citadas', 'Most cited')}</span>
            {stats.topCited.map((m) => (
              <Link
                key={m.id}
                href={`/projects/${projectSlug}/brain/${m.id}`}
                className={styles.topCitedItem}
              >
                {m.title.slice(0, 50)}
                {m.title.length > 50 ? '…' : ''}{' '}
                <span>×{m.citationCount}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {showNew && (
        <NewMemoryForm
          projectSlug={projectSlug}
          onCreated={() => {
            setShowNew(false);
            router.refresh();
          }}
        />
      )}

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'project' ? styles.tabActive : ''}`}
          onClick={() => setTab('project')}
        >
          § {t('Principal', 'Main')}
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'local' ? styles.tabActive : ''}`}
          onClick={() => setTab('local')}
        >
          ※ {t('Mi local', 'My local')}
        </button>
        {isOwner && (
          <button
            className={`${styles.tab} ${activeTab === 'audit' ? styles.tabActive : ''}`}
            onClick={() => setTab('audit')}
          >
            ⁂ {t('Auditoría', 'Audit')}
          </button>
        )}
      </div>

      {activeTab === 'audit' && auditByAuthor && auditByAuthor.length > 0 && (
        <section className={styles.auditTable}>
          <h3>{t('Contribución por miembro', 'Contribution by member')}</h3>
          <table>
            <thead>
              <tr>
                <th>{t('Miembro', 'Member')}</th>
                <th>{t('Rol', 'Role')}</th>
                <th title={t('Memorias en su cerebro local', 'Memories in their local brain')}>
                  {t('Local', 'Local')}
                </th>
                <th title={t('Memorias publicadas al cerebro del proyecto', 'Memories published to the project brain')}>
                  {t('Principal', 'Main')}
                </th>
                <th title={t('Memorias propias que ya fueron citadas', 'Own memories that have already been cited')}>
                  {t('Citadas', 'Cited')}
                </th>
                <th title={t('Memorias propias sin cita en 6+ meses', 'Own memories with no citation in 6+ months')}>
                  {t('Stale', 'Stale')}
                </th>
              </tr>
            </thead>
            <tbody>
              {auditByAuthor.map((m) => (
                <tr key={m.userId}>
                  <td>
                    <strong>{m.name}</strong>
                    <span className={styles.auditEmail}>{m.email}</span>
                  </td>
                  <td>
                    <span className={styles.roleBadge}>{m.role}</span>
                  </td>
                  <td className={styles.numCell}>{m.local}</td>
                  <td className={styles.numCell}>{m.project}</td>
                  <td className={styles.numCell}>{m.cited}</td>
                  <td className={`${styles.numCell} ${m.stale > 0 ? styles.numStale : ''}`}>
                    {m.stale}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <form onSubmit={submitSearch} className={styles.filters}>
        <input
          type="search"
          placeholder={t('Buscar en el cuaderno…', 'Search the notebook…')}
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          className={styles.search}
        />
        <select
          value={typeFilter ?? ''}
          onChange={(e) => setParam('type', e.target.value || null)}
          className={styles.select}
        >
          <option value="">{t('Todos los tipos', 'All types')}</option>
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {tagFilter && (
          <span className={styles.tagFilter}>
            <code>#{tagFilter}</code>
            <button type="button" onClick={() => setParam('tag', null)} aria-label={t('Quitar filtro', 'Remove filter')}>
              ×
            </button>
          </span>
        )}
        <button type="submit" disabled={pending} className={styles.searchBtn}>
          {pending ? '…' : t('Buscar', 'Search')}
        </button>
      </form>

      <div className={styles.results}>
        {memories.length === 0 ? (
          <p className={styles.empty}>
            {t('El cuaderno aguarda su primera entrada. Cierra una tarea con curiosidad o pulsa', 'The notebook awaits its first entry. Close a task with curiosity or press')}{' '}
            <em>{t('Nueva entrada', 'New entry')}</em>.
          </p>
        ) : (
          memories.map((m, i) => (
            <MemoryCard
              key={m.id}
              projectSlug={projectSlug}
              memory={m}
              currentUserId={currentUserId}
              isOwner={isOwner}
              onTagClick={(tag) => setParam('tag', tag)}
              index={i}
            />
          ))
        )}
      </div>

      <RuleDivider variant="ornament" spacing="xl" />
    </div>
  );
}
