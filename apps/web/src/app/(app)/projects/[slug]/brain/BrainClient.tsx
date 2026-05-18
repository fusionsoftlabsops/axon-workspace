'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
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
            Bitácora compartida del proyecto
          </Eyebrow>
          <h1 className={styles.title}>El cerebro</h1>
          <p className={styles.subtitle}>
            Conocimiento curado: decisiones, trampas, patrones y runbooks. Lo que se publica al
            principal queda visible para todo el equipo.
          </p>
        </div>
        <button onClick={() => setShowNew((v) => !v)} className={styles.newBtn}>
          {showNew ? 'Cancelar' : '+ Nueva entrada'}
        </button>
      </header>

      <div aria-hidden className={styles['masthead-rule']} />

      <div className={styles.statsStrip}>
        <Stat value={stats.project} label="en cerebro principal" />
        <Stat value={stats.local} label="en tu local" />
        <Stat
          value={stats.stale}
          label="stale (>6 meses)"
          hint="sin uso reciente"
          active={staleActive}
          trend={stats.stale > 0 ? 'warn' : 'flat'}
          onClick={() => setParam('stale', staleActive ? null : '1')}
        />
        <Stat
          value={stats.orphans}
          label="huérfanas"
          hint="cero citations"
          active={orphansActive}
          onClick={() => setParam('orphans', orphansActive ? null : '1')}
        />
        {stats.topCited.length > 0 && (
          <div className={styles.topCited}>
            <span className={styles.topCitedLabel}>Más citadas</span>
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
          § Principal
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'local' ? styles.tabActive : ''}`}
          onClick={() => setTab('local')}
        >
          ※ Mi local
        </button>
        {isOwner && (
          <button
            className={`${styles.tab} ${activeTab === 'audit' ? styles.tabActive : ''}`}
            onClick={() => setTab('audit')}
          >
            ⁂ Auditoría
          </button>
        )}
      </div>

      {activeTab === 'audit' && auditByAuthor && auditByAuthor.length > 0 && (
        <section className={styles.auditTable}>
          <h3>Contribución por miembro</h3>
          <table>
            <thead>
              <tr>
                <th>Miembro</th>
                <th>Rol</th>
                <th title="Memorias en su cerebro local">Local</th>
                <th title="Memorias publicadas al cerebro del proyecto">Principal</th>
                <th title="Memorias propias que ya fueron citadas">Citadas</th>
                <th title="Memorias propias sin citation en 6+ meses">Stale</th>
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
          placeholder="Buscar en el cuaderno…"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          className={styles.search}
        />
        <select
          value={typeFilter ?? ''}
          onChange={(e) => setParam('type', e.target.value || null)}
          className={styles.select}
        >
          <option value="">Todos los tipos</option>
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {tagFilter && (
          <span className={styles.tagFilter}>
            <code>#{tagFilter}</code>
            <button type="button" onClick={() => setParam('tag', null)} aria-label="Quitar filtro">
              ×
            </button>
          </span>
        )}
        <button type="submit" disabled={pending} className={styles.searchBtn}>
          {pending ? '…' : 'Buscar'}
        </button>
      </form>

      <div className={styles.results}>
        {memories.length === 0 ? (
          <p className={styles.empty}>
            El cuaderno aguarda su primera entrada. Cierra una tarea con curiosidad o pulsa{' '}
            <em>Nueva entrada</em>.
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
