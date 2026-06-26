'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button } from '@/components/ui';
import { useI18n } from '@/lib/i18n/i18n';
import { getAnalysisAction, analyzeProjectAction, type AnalysisView } from '@/lib/actions/analysis';
import styles from './plan.module.scss';

/**
 * "Analyze existing project" panel: triggers graphify-svc over the project's
 * linked repos, polls until the code knowledge graph is READY, and shows that
 * planning is now grounded in the real code (brownfield). When graphify-svc is
 * not configured, it renders a quiet hint and never blocks greenfield planning.
 */
export function AnalysisPanel({ slug, canWrite }: { slug: string; canWrite: boolean }) {
  const { t } = useI18n();
  const [view, setView] = useState<AnalysisView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const r = await getAnalysisAction(slug);
    if (r.ok && r.data) setView(r.data);
  }, [slug]);

  useEffect(() => {
    void load();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [load]);

  // Poll while an analysis is running.
  useEffect(() => {
    if (view?.status !== 'ANALYZING') return;
    pollRef.current = setTimeout(() => void load(), 4000);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [view?.status, view?.updatedAt, load]);

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

  async function run() {
    setBusy(true);
    setError(null);
    const r = await analyzeProjectAction(slug);
    if (!r.ok) setError(r.error);
    else if (r.data) setView(r.data);
    setBusy(false);
  }

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
