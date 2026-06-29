'use client';

import { useState } from 'react';
import { SignalLine, type SignalState } from '@/components/SignalLine';
import { useI18n } from '@/lib/i18n/i18n';
import { setPlanContextGraphAction, type ContextGraph, type PlanView } from '@/lib/actions/planning';
import { AnalysisPanelView } from './AnalysisPanel';
import { useAnalysis } from './useAnalysis';
import styles from './plan.module.scss';

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
  onChange,
}: {
  slug: string;
  canWrite: boolean;
  contextGraph: ContextGraph | null;
  onChange: (plan: PlanView) => void;
}) {
  const { t } = useI18n();
  const analysis = useAnalysis(slug);
  const view = analysis.view;
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // `null` means "auto" → the code graph is the effective source.
  const selected: ContextGraph = contextGraph === 'NONE' ? 'NONE' : 'CODE_GRAPH';

  // No graph service on this instance, or still loading → just the panel
  // (which renders its own quiet hint). Nothing to connect.
  if (!view || !view.configured) {
    return <AnalysisPanelView controller={analysis} canWrite={canWrite} />;
  }

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
            'Elige en qué grafo se ancla el plan. El chat y la generación lo tendrán en cuenta.',
            'Choose which graph grounds the plan. The chat and generation will take it into account.',
          )}
        </p>
      </div>

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

        {/* No context (greenfield) */}
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
            <span className={styles.ctxOptName}>{t('Sin contexto', 'No context')}</span>
            <span className={styles.ctxOptDesc}>
              {t('Planea desde cero, sin anclar en código existente.', 'Plan from scratch, not grounded in existing code.')}
            </span>
          </span>
        </label>
      </div>

      {err && <p className={styles.error}>{err}</p>}

      <AnalysisPanelView controller={analysis} canWrite={canWrite} />
    </section>
  );
}
