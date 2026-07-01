'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n/i18n';
import type { PlanProgress as Progress } from '@/lib/actions/planning';

// A GENERATING plan whose heartbeat is older than this is treated as orphaned
// (server likely restarted mid-run). Mirrors PLAN_STALE_MS on the server.
const STALE_MS = 5 * 60 * 1000;

const PHASE_PCT: Record<Progress['phase'], number> = {
  starting: 8,
  resolving_context: 25,
  code_context: 45,
  calling_opus: 75,
  normalizing: 92,
};

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

/**
 * Live progress for plan generation: phase label, a phase-based bar, an elapsed
 * timer, and a "you can leave and come back" reassurance. If the heartbeat goes
 * stale (orphaned run), it surfaces a retry instead of spinning forever.
 */
export function PlanProgress({
  progress,
  heartbeatAt,
  onRetry,
  retrying,
}: {
  progress: Progress | null;
  heartbeatAt: string | null;
  onRetry: () => void;
  retrying?: boolean;
}) {
  const { t } = useI18n();
  const [now, setNow] = useState<number | null>(null);

  // Tick once a second for the elapsed timer + staleness check. Initialized in
  // the effect (not at render) to stay deterministic for SSR/tests.
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const phase = progress?.phase ?? 'starting';
  const pct = PHASE_PCT[phase];
  const label =
    phase === 'resolving_context'
      ? t('Reuniendo el contexto…', 'Gathering context…')
      : phase === 'code_context'
        ? t('Cargando el grafo de código…', 'Loading the code graph…')
        : phase === 'calling_opus'
          ? t('Generando el plan con Claude Opus…', 'Generating the plan with Claude Opus…')
          : phase === 'normalizing'
            ? t('Afinando estimaciones…', 'Finalizing estimates…')
            : t('Iniciando…', 'Starting…');

  const startedMs = progress ? Date.parse(progress.startedAt) : NaN;
  const elapsed = now !== null && !Number.isNaN(startedMs) ? now - startedMs : 0;
  const hbMs = heartbeatAt ? Date.parse(heartbeatAt) : NaN;
  const stale = now !== null && !Number.isNaN(hbMs) && now - hbMs > STALE_MS;

  if (stale) {
    return (
      <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <strong>{t('Parece que la generación se interrumpió', 'The generation seems to have stalled')}</strong>
        <span style={{ fontSize: '0.85rem', color: 'var(--color-fg-muted)' }}>
          {t(
            'No recibimos señales del proceso en varios minutos (puede haberse reiniciado el servidor). Podés reintentar.',
            "We haven't heard from the process in several minutes (the server may have restarted). You can retry.",
          )}
        </span>
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          style={{
            alignSelf: 'flex-start',
            padding: '0.45rem 1rem',
            border: 'none',
            borderRadius: '4px',
            background: 'var(--color-accent)',
            color: 'var(--color-accent-fg)',
            fontWeight: 600,
          }}
        >
          {retrying ? t('Reintentando…', 'Retrying…') : t('Reintentar', 'Retry')}
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-fg-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {fmtElapsed(elapsed)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ height: 6, borderRadius: 4, background: 'rgba(127,127,127,0.18)', overflow: 'hidden' }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: 'var(--color-accent, #6ea8fe)',
            transition: 'width .6s ease',
          }}
        />
      </div>
      <span style={{ fontSize: '0.8rem', color: 'var(--color-fg-muted)' }}>
        {t(
          'Podés cerrar esta pestaña y volver: el plan sigue generándose en el servidor.',
          'You can close this tab and come back — the plan keeps generating on the server.',
        )}
      </span>
    </div>
  );
}
