'use client';

import { useState } from 'react';
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
 * "Planning context" — lets the user explicitly connect the plan to a graph and
 * choose which one. Today there is one grounding graph (the graphify code
 * knowledge graph); the chooser also offers "no context" (greenfield). The
 * choice is persisted on the plan and read by the chat and the generator.
 *
 * The selected source carries a Signal Console "live link": a steady glow when
 * the graph is connected and ready, a travelling pulse while it builds.
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

  // The code-graph chooser only applies when graphify is wired up; the file
  // context line always applies.
  const graphConfigured = view.configured;
  const ready = view.status === 'READY';
  const analyzing = view.status === 'ANALYZING';
  const failed = view.status === 'FAILED';
  const stats = view.stats ?? {};

  const linked = selected === 'CODE_GRAPH';
  const codeSignal: SignalState = analyzing
    ? 'active'
    : failed
      ? 'failed'
      : ready && linked
        ? 'live'
        : 'idle';

  const codeStatus = analyzing
    ? t('Generando el grafo…', 'Building the graph…')
    : ready
      ? `${String(stats.nodes ?? '?')} ${t('nodos', 'nodes')} · ${String(stats.edges ?? '?')} ${t('relaciones', 'edges')} · ${String(stats.communities ?? '?')} ${t('áreas', 'areas')}`
      : failed
        ? t('El último análisis falló — re-analiza abajo.', 'The last analysis failed — re-analyze below.')
        : t('Aún sin grafo — genéralo abajo.', 'No graph yet — generate it below.');

  async function choose(next: ContextGraph) {
    if (next === selected || saving || !canWrite) return;
    setSaving(true);
    setErr(null);
    const r = await setPlanContextGraphAction(slug, next);
    if (!r.ok) setErr(r.error);
    else if (r.data) onChange(r.data);
    setSaving(false);
  }

  return (
    <section className={styles.ctxCard} aria-busy={saving}>
      <div className={styles.ctxHead}>
        <span className={styles.ctxLbl}>{t('Contexto de planeación', 'Planning context')}</span>
        <p className={styles.ctxLead}>
          {t(
            'Define en qué se ancla el plan: el grafo del código y los archivos marcados como contexto. El chat y la generación los tienen en cuenta.',
            'Set what grounds the plan: the code graph and the files marked as context. The chat and generation take them into account.',
          )}
        </p>
      </div>

      {graphConfigured && (
      <div className={styles.ctxOptions} role="radiogroup" aria-label={t('Grafo de contexto', 'Context graph')}>
        {/* Code knowledge graph */}
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
            <span className={styles.ctxOptName}>{t('Grafo de código', 'Code graph')}</span>
            <span className={styles.ctxOptDesc}>
              {t(
                'Ancla el plan en el grafo de conocimiento del código existente (graphify).',
                'Grounds the plan in the existing code knowledge graph (graphify).',
              )}
            </span>
            <SignalLine state={codeSignal} className={styles.ctxSignal} />
            <span className={styles.ctxStatus} data-state={codeSignal}>
              {linked && ready ? `${t('Conectado', 'Connected')} · ${codeStatus}` : codeStatus}
            </span>
          </span>
        </label>

        {/* No code graph (greenfield) */}
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
            <span className={styles.ctxOptName}>{t('Sin grafo de código', 'No code graph')}</span>
            <span className={styles.ctxOptDesc}>
              {t(
                'No ancles en el código existente (los archivos de contexto siguen aplicando).',
                'Don’t ground in existing code (context files still apply).',
              )}
            </span>
          </span>
        </label>
      </div>
      )}

      {/* Project files — mark which feed the plan, right here in the chat view. */}
      <div className={styles.ctxFilesBlock}>
        <div className={styles.ctxFilesHead}>
          <span className={styles.ctxLbl}>
            <span aria-hidden className={styles.ctxStar}>✦</span> {t('Archivos del proyecto', 'Project files')}
          </span>
          <Link href={`/projects/${slug}/files`} className={styles.ctxFilesLink}>
            {t('Subir / ver en Archivos', 'Upload / view in Files')}
          </Link>
        </div>

        {contextFiles.length === 0 ? (
          <p className={styles.ctxLead}>
            {t(
              'Aún no has subido archivos. Súbelos en Archivos y vuelve para usarlos como contexto.',
              'No files uploaded yet. Upload them in Files and come back to use them as context.',
            )}
          </p>
        ) : (
          <>
            <p className={styles.ctxLead}>
              {t(
                'Marca los archivos que la IA debe usar como contexto. Deseleccionar aquí se guarda.',
                'Tick the files the AI should use as context. Deselecting here is saved.',
              )}
            </p>
            <ul className={styles.ctxFileList}>
              {contextFiles.map((f) => {
                const on = isFileOn(f);
                const usable = isUsable(f);
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
                        disabled={!canWrite || !usable || fileBusy === f.id}
                        onChange={() => toggleFile(f)}
                      />
                      <span aria-hidden className={styles.ctxFileGlyph}>{FILE_GLYPH(f.category)}</span>
                      <span className={styles.ctxFileName} title={f.name}>{f.name}</span>
                      {fileBusy === f.id && <span className={styles.ctxFileSpin}>…</span>}
                    </label>
                    {!usable && (
                      <span className={styles.ctxFileHint}>
                        {f.contextStatus === 'GENERATING'
                          ? t('generando…', 'generating…')
                          : t('genera el contexto en Archivos', 'generate context in Files')}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {err && <p className={styles.error}>{err}</p>}

      <AnalysisPanelView controller={analysis} canWrite={canWrite} />
    </section>
  );
}
