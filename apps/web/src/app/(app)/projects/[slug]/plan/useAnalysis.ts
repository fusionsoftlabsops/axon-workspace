'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAnalysisAction, analyzeProjectAction, type AnalysisView } from '@/lib/actions/analysis';

export interface AnalysisController {
  view: AnalysisView | null;
  busy: boolean;
  error: string | null;
  run: () => Promise<void>;
}

/**
 * Loads the code-analysis (graphify) state for a project and polls while an
 * analysis is running. Shared so the planning-context picker and the analysis
 * panel read from a single source of truth (and a single poller).
 */
export function useAnalysis(slug: string): AnalysisController {
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

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    const r = await analyzeProjectAction(slug);
    if (!r.ok) setError(r.error);
    else if (r.data) setView(r.data);
    setBusy(false);
  }, [slug]);

  return { view, busy, error, run };
}
