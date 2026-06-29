'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { FileCategory } from '@prisma/client';
import { SignalLine, type SignalState } from '@/components/SignalLine';
import { useI18n } from '@/lib/i18n/i18n';
import { setPlanContextGraphAction, type ContextGraph, type PlanView } from '@/lib/actions/planning';
import { setFileContextAction } from '@/lib/actions/files';
import { AnalysisPanelView } from './AnalysisPanel';
import { useAnalysis } from './useAnalysis';
import styles from './plan.module.scss';

export interface ContextFile {
  id: string;
  name: string;
  category: FileCategory;
  isContext: boolean;
  contextStatus: 'NONE' | 'GENERATING' | 'READY' | 'FAILED';
}

/** A file can be used as context when it's an image (vision) or a document whose
 *  context artifact is READY. */
const isUsable = (f: ContextFile) => f.category === 'IMAGE' || f.contextStatus === 'READY';

const FILE_GLYPH = (cat: FileCategory): string =>
  cat === 'IMAGE' ? '▦' : cat === 'PDF' ? '◳' : cat === 'CODE' ? '⟨⟩' : '▤';

/**
 * "Planning context" — the side panel where the user sets what the AI plans
 * from: the code knowledge graph (or none) and the project files marked as
 * context. The choices are persisted and read by the chat and the generator.
 */
export function PlanContext({
  slug,
  canWrite,
  contextGraph,
  contextFiles = [],
  onChange,
}: {
  slug: string;
  canWrite: boolean;
  contextGraph: ContextGraph | null;
  contextFiles?: ContextFile[];
  onChange: (plan: PlanView) => void;
}) {
  const { t } = useI18n();
  const analysis = useAnalysis(slug);
  const view = analysis.view;
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Optimistic context flags for the file list, layered over the server value.
  const [fileOn, setFileOn] = useState<Record<string, boolean>>({});
  const [fileBusy, setFileBusy] = useState<string | null>(null);
  const isFileOn = (f: ContextFile) => fileOn[f.id] ?? f.isContext;
  // Each context section is a collapsible card — collapsed by default.
  const [openSecs, setOpenSecs] = useState<Set<string>>(() => new Set());
  const toggleSec = (id: string) =>
    setOpenSecs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const accordion = (id: string, glyph: string, title: string, chip: ReactNode, body: ReactNode): ReactNode => {
    const open = openSecs.has(id);
    return (
      <div className={styles.ctxAcc}>
        <h3 className={styles.ctxAccHeading}>
          <button
            type="button"
            className={styles.ctxAccHead}
            aria-expanded={open}
            onClick={() => toggleSec(id)}
          >
            <span aria-hidden className={styles.chevron}>{open ? '▾' : '▸'}</span>
            <span aria-hidden className={styles.ctxSecGlyph}>{glyph}</span>
            <span className={styles.ctxSecTitle}>{title}</span>
            {chip}
          </button>
        </h3>
        {open && <div className={styles.ctxAccBody}>{body}</div>}
      </div>
    );
  };

  async function toggleFile(f: ContextFile) {
    if (!canWrite || fileBusy) return;
    const next = !isFileOn(f);
    setErr(null);
    setFileBusy(f.id);
    setFileOn((prev) => ({ ...prev, [f.id]: next }));
    const r = await setFileContextAction(slug, f.id, next);
    setFileBusy(null);
    if (!r.ok) {
      setFileOn((prev) => ({ ...prev, [f.id]: !next })); // revert
      setErr(r.error);
    }
  }

  // `null` means "auto" → the code graph is the effective source.
  const selected: ContextGraph = contextGraph === 'NONE' ? 'NONE' : 'CODE_GRAPH';

  // Still loading → render nothing yet (the panel renders null without a view).
  if (!view) {
    return <AnalysisPanelView controller={analysis} canWrite={canWrite} />;
  }

  const graphConfigured = view.configured;
  const ready = view.status === 'READY';
  const analyzing = view.status === 'ANALYZING';
  const failed = view.status === 'FAILED';

  const linked = selected === 'CODE_GRAPH';
  const codeSignal: SignalState = analyzing ? 'active' : failed ? 'failed' : ready && linked ? 'live' : 'idle';

  // One quick status chip for the graph section.
  const graphChip: { label: string; state: SignalState } = analyzing
    ? { label: t('Generando…', 'Building…'), state: 'active' }
    : failed
      ? { label: t('Falló', 'Failed'), state: 'failed' }
      : ready
        ? linked
          ? { label: t('Conectado', 'Connected'), state: 'live' }
          : { label: t('Disponible', 'Available'), state: 'idle' }
        : { label: t('Sin grafo', 'No graph'), state: 'idle' };

  const onCount = contextFiles.filter(isFileOn).length;
  const usableCount = contextFiles.filter(isUsable).length;

  function fileStatus(f: ContextFile, on: boolean, usable: boolean): { label: string; cls: string } {
    if (on) return { label: t('En contexto', 'In context'), cls: styles.ctxStOn ?? '' };
    if (f.contextStatus === 'GENERATING') return { label: t('Generando…', 'Building…'), cls: styles.ctxStBusy ?? '' };
    if (usable) return { label: t('Listo', 'Ready'), cls: styles.ctxStReady ?? '' };
    return { label: t('Genera en Archivos', 'Generate in Files'), cls: styles.ctxStOff ?? '' };
  }

  async function choose(next: ContextGraph) {
    if (next === selected || saving || !canWrite) return;
    setSaving(true);
    setErr(null);
    const r = await setPlanContextGraphAction(slug, next);
    if (!r.ok) setErr(r.error);
    else if (r.data) onChange(r.data);
    setSaving(false);
  }

  const analysisChip: { label: string; state: SignalState } = analyzing
    ? { label: t('Analizando…', 'Analyzing…'), state: 'active' }
    : ready
      ? { label: t('Listo', 'Ready'), state: 'live' }
      : failed
        ? { label: t('Falló', 'Failed'), state: 'failed' }
        : { label: t('Sin analizar', 'Not analyzed'), state: 'idle' };

  const chip = (label: string, state: SignalState) => (
    <span className={styles.ctxChip} data-state={state}>{label}</span>
  );

  return (
    <section className={styles.ctxCard} aria-busy={saving}>
      <div className={styles.ctxHead}>
        <span className={styles.ctxLbl}>{t('Contexto de planeación', 'Planning context')}</span>
        <p className={styles.ctxLead}>
          {t(
            'Elige en qué se basa la IA para planear. El chat y la generación lo tienen en cuenta.',
            'Choose what the AI plans from. The chat and generation take it into account.',
          )}
        </p>
      </div>

      {/* ---- Code graph ---- */}
      {graphConfigured &&
        accordion(
          'graph',
          '◈',
          t('Grafo de código', 'Code graph'),
          chip(graphChip.label, graphChip.state),
          <>
            <SignalLine state={codeSignal} className={styles.ctxSignal} />
            <div className={styles.ctxOptions} role="radiogroup" aria-label={t('Grafo de contexto', 'Context graph')}>
              <label className={`${styles.ctxOption} ${linked ? styles.ctxOptionOn : ''}`}>
                <input
                  type="radio"
                  name="plan-context-graph"
                  className={styles.ctxRadio}
                  checked={linked}
                  disabled={!canWrite || saving}
                  onChange={() => choose('CODE_GRAPH')}
                />
                <span className={styles.ctxOptBody}>
                  <span className={styles.ctxOptName}>{t('Usar el grafo del código', 'Use the code graph')}</span>
                  <span className={styles.ctxOptDesc}>
                    {t(
                      'Ancla el plan en el grafo de conocimiento del código existente (graphify).',
                      'Grounds the plan in the existing code knowledge graph (graphify).',
                    )}
                  </span>
                </span>
              </label>

              <label className={`${styles.ctxOption} ${selected === 'NONE' ? styles.ctxOptionOn : ''}`}>
                <input
                  type="radio"
                  name="plan-context-graph"
                  className={styles.ctxRadio}
                  checked={selected === 'NONE'}
                  disabled={!canWrite || saving}
                  onChange={() => choose('NONE')}
                />
                <span className={styles.ctxOptBody}>
                  <span className={styles.ctxOptName}>{t('Planear sin grafo', 'Plan without a graph')}</span>
                  <span className={styles.ctxOptDesc}>
                    {t(
                      'No ancles en el código existente (los archivos de contexto siguen aplicando).',
                      'Don’t ground in existing code (context files still apply).',
                    )}
                  </span>
                </span>
              </label>
            </div>
          </>,
        )}

      {/* ---- Context files ---- */}
      {accordion(
        'files',
        '✦',
        t('Archivos de contexto', 'Context files'),
        usableCount > 0 ? chip(`${onCount}/${usableCount}`, onCount > 0 ? 'live' : 'idle') : null,
        <>
          <Link href={`/projects/${slug}/files`} className={styles.ctxSecLink}>
            {t('Gestionar en Archivos', 'Manage in Files')}
          </Link>
          {contextFiles.length === 0 ? (
            <div className={styles.ctxEmpty}>
              <p className={styles.ctxLead}>
                {t('Aún no hay archivos para usar como contexto.', 'No files to use as context yet.')}
              </p>
              <Link href={`/projects/${slug}/files`} className={styles.ctxEmptyCta}>
                {t('Subir archivos', 'Upload files')}
              </Link>
            </div>
          ) : (
            <ul className={styles.ctxFileList}>
              {contextFiles.map((f) => {
                const on = isFileOn(f);
                const usable = isUsable(f);
                const busyHere = fileBusy === f.id;
                const st = fileStatus(f, on, usable);
                return (
                  <li
                    key={f.id}
                    className={`${styles.ctxFileItem} ${on ? styles.ctxFileItemOn : ''} ${usable ? '' : styles.ctxFileItemOff}`}
                  >
                    <label className={styles.ctxFileLabel}>
                      <input
                        type="checkbox"
                        className={styles.ctxFileCheck}
                        checked={on}
                        disabled={!canWrite || !usable || busyHere}
                        onChange={() => toggleFile(f)}
                      />
                      <span aria-hidden className={styles.ctxFileGlyph}>{FILE_GLYPH(f.category)}</span>
                      <span className={styles.ctxFileName} title={f.name}>{f.name}</span>
                      {busyHere ? (
                        <span className={styles.ctxFileSpin}>…</span>
                      ) : (
                        <span className={`${styles.ctxFileStatus} ${st.cls}`}>{st.label}</span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </>,
      )}

      {err && <p className={styles.error}>{err}</p>}

      {/* ---- Manage the code graph (analyze / re-analyze) ---- */}
      {accordion(
        'analysis',
        '◇',
        t('Análisis del código', 'Code analysis'),
        graphConfigured ? chip(analysisChip.label, analysisChip.state) : null,
        <AnalysisPanelView controller={analysis} canWrite={canWrite} hideHeading />,
      )}
    </section>
  );
}
