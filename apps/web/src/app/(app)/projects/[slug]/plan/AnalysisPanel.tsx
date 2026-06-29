'use client';

import { Badge, Button } from '@/components/ui';
import { useI18n } from '@/lib/i18n/i18n';
import { useAnalysis, type AnalysisController } from './useAnalysis';
import styles from './plan.module.scss';

/**
 * "Analyze existing project" panel: triggers graphify-svc over the project's
 * linked repos, polls until the code knowledge graph is READY, and shows that
 * planning is now grounded in the real code (brownfield). When graphify-svc is
 * not configured, it renders a quiet hint and never blocks greenfield planning.
 *
 * `AnalysisPanelView` is the presentational half driven by an external
 * controller, so the planning-context picker can share one poller with it.
 */
export function AnalysisPanelView({
  controller,
  canWrite,
}: {
  controller: AnalysisController;
  canWrite: boolean;
}) {
  const { t } = useI18n();
  const { view, busy, error, run } = controller;

  if (!view) return null;

  // graphify-svc not wired up on this instance — keep it quiet.
  if (!view.configured) {
    return (
      <div className={styles.repoCard}>
        <h3>{t('Análisis del código', 'Code analysis')}</h3>
        <p className={styles.repoReason}>
          {t(
            'El análisis de código (grafo de conocimiento) no está configurado en esta instancia.',
            'Code analysis (knowledge graph) is not configured on this instance.',
          )}
        </p>
      </div>
    );
  }

  const analyzing = view.status === 'ANALYZING';
  const ready = view.status === 'READY';
  const failed = view.status === 'FAILED';
  const stats = view.stats ?? {};

  // Live progress (mirrored into stats while ANALYZING).
  const phase = analyzing ? (stats.phase as string | undefined) : undefined;
  const pct = analyzing && typeof stats.percent === 'number' ? Math.min(100, Math.max(0, stats.percent as number)) : null;
  const phaseLabel =
    phase === 'cloning'
      ? t('Clonando repos…', 'Cloning repos…')
      : phase === 'extracting'
        ? t('Extrayendo y analizando con IA…', 'Extracting & analyzing with AI…')
        : phase === 'building'
          ? t('Construyendo el grafo…', 'Building the graph…')
          : t('Analizando…', 'Analyzing…');
  const chunkInfo =
    typeof stats.chunksTotal === 'number'
      ? ` (${Number(stats.chunksDone ?? 0)}/${Number(stats.chunksTotal)})`
      : '';

  return (
    <div className={styles.repoCard}>
      <div className={styles.repoName}>
        <span>{t('Análisis del código', 'Code analysis')}</span>{' '}
        {ready && <Badge tone="accent">{t('Plan anclado en el código real', 'Plan grounded in real code')}</Badge>}
        {analyzing && <Badge tone="neutral">{t('Analizando…', 'Analyzing…')}</Badge>}
        {failed && <Badge tone="bad">{t('Falló', 'Failed')}</Badge>}
      </div>

      <p className={styles.repoReason}>
        {t(
          'Genera un grafo de conocimiento de los repos vinculados (graphify) y ancla la planeación en el código existente.',
          'Builds a knowledge graph of the linked repos (graphify) and grounds planning in the existing code.',
        )}
      </p>

      {view.analyzableRepoCount === 0 && (
        <p className={styles.repoReason}>
          {t(
            'Vincula al menos un repo con identidad de GitHub (abajo) para poder analizar.',
            'Link at least one repo with a GitHub identity (below) to analyze.',
          )}
        </p>
      )}

      {analyzing && (
        <div style={{ marginTop: '0.6rem' }}>
          <div
            style={{ height: 6, borderRadius: 4, background: 'rgba(127,127,127,0.18)', overflow: 'hidden' }}
            role="progressbar"
            aria-valuenow={pct ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              style={{
                height: '100%',
                width: `${pct ?? 6}%`,
                background: 'var(--accent, #6ea8fe)',
                transition: 'width .5s ease',
              }}
            />
          </div>
          <p className={styles.repoReason}>
            {phaseLabel}
            {chunkInfo}
            {pct !== null ? ` · ${pct}%` : ''}
            {stats.repo ? ` · ${String(stats.repo)}` : ''}
          </p>
        </div>
      )}

      {ready && (
        <>
          <p className={styles.repoReason}>
            {String(stats.nodes ?? '?')} {t('nodos', 'nodes')} · {String(stats.edges ?? '?')}{' '}
            {t('relaciones', 'edges')} · {String(stats.communities ?? '?')} {t('áreas', 'areas')}
            {view.backend ? ` · ${view.backend}` : ''}
          </p>
          {view.summary && (
            <div className={styles.analysisSummary} style={{ whiteSpace: 'pre-line' }}>
              {view.summary}
            </div>
          )}
          {view.godNodes.length > 0 && (
            <p className={styles.repoReason}>
              {t('Conceptos centrales: ', 'Key concepts: ')}
              {view.godNodes.slice(0, 6).map((g) => g.label).join(' · ')}
            </p>
          )}
        </>
      )}

      {failed && view.error && <p className={styles.error}>{view.error}</p>}
      {error && <p className={styles.error}>{error}</p>}

      {canWrite && (
        <div className={styles.rowActions}>
          <Button
            variant="primary"
            disabled={busy || analyzing || view.analyzableRepoCount === 0}
            onClick={run}
          >
            {analyzing
              ? t('Analizando…', 'Analyzing…')
              : ready || failed
                ? t('Re-analizar', 'Re-analyze')
                : t('Analizar proyecto existente', 'Analyze existing project')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Self-contained panel (owns its own poller). Used standalone on the Context tab. */
export function AnalysisPanel({ slug, canWrite }: { slug: string; canWrite: boolean }) {
  const controller = useAnalysis(slug);
  return <AnalysisPanelView controller={controller} canWrite={canWrite} />;
}
