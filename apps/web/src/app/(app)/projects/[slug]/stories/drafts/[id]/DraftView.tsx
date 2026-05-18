'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { publishStoryDraftAsTaskAction } from '@/lib/actions/stories';
import styles from '../../stories.module.scss';

interface DraftState {
  id: string;
  status: 'GENERATING' | 'READY' | 'ERRORED' | 'PUBLISHED';
  errorMessage: string | null;
  rawInput: string;
  summary: string | null;
  acceptanceCriteria: string | null;
  technicalContext: string | null;
  subtaskBreakdown: Array<{
    title: string;
    description?: string;
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  }> | null;
  filesToTouch: Array<{ path: string; reason: string }> | null;
  risks: string | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: string;
  durationMs: number;
  taskId: string | null;
  citedMemoryIds: string[];
}

interface State {
  id: string;
  name: string;
  color: string;
}

export function DraftView({
  projectSlug,
  initialDraft,
  states,
  canPublish,
}: {
  projectSlug: string;
  initialDraft: DraftState;
  states: State[];
  canPublish: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftState>(initialDraft);
  const [stateId, setStateId] = useState<string>(states[0]?.id ?? '');
  const [includedSubtasks, setIncludedSubtasks] = useState<Set<number>>(new Set());
  const [pending, startTransition] = useTransition();
  const [publishError, setPublishError] = useState<string | null>(null);

  // Polling mientras GENERATING
  useEffect(() => {
    if (draft.status !== 'GENERATING') return;
    let cancelled = false;
    const tick = async () => {
      try {
        const resp = await fetch(
          `/api/v1/projects/${projectSlug}/stories/drafts/${draft.id}`,
          { credentials: 'include' },
        );
        if (!resp.ok) return;
        const data = await resp.json();
        if (cancelled) return;
        setDraft((prev) => ({
          ...prev,
          status: data.status,
          errorMessage: data.errorMessage,
          summary: data.summary,
          acceptanceCriteria: data.acceptanceCriteria,
          technicalContext: data.technicalContext,
          subtaskBreakdown: data.subtaskBreakdown,
          filesToTouch: data.filesToTouch,
          risks: data.risks,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          estimatedCostUsd: data.estimatedCostUsd,
          durationMs: data.durationMs,
          taskId: data.taskId,
        }));
      } catch { /* swallow polling errors */ }
    };
    const intervalId = setInterval(tick, 1500);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [draft.status, draft.id, projectSlug]);

  // Default: incluir TODAS las subtareas cuando llegan
  useEffect(() => {
    if (draft.subtaskBreakdown && includedSubtasks.size === 0) {
      setIncludedSubtasks(new Set(draft.subtaskBreakdown.map((_, i) => i)));
    }
  }, [draft.subtaskBreakdown]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSubtask = (idx: number) => {
    setIncludedSubtasks((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const onPublish = () => {
    setPublishError(null);
    startTransition(async () => {
      const res = await publishStoryDraftAsTaskAction(draft.id, {
        stateId,
        includeSubtasks: Array.from(includedSubtasks).sort((a, b) => a - b),
      });
      if (!res.ok) {
        setPublishError(res.error);
        return;
      }
      router.push(`/projects/${projectSlug}/board`);
    });
  };

  return (
    <div className={styles.viewer}>
      <div className={styles.viewerMain}>
        <Section title="Resumen" body={draft.summary} placeholder="generando…" />
        <Section title="Contexto técnico" body={draft.technicalContext} placeholder="generando…" />
        <Section title="Criterios de aceptación" body={draft.acceptanceCriteria} placeholder="generando…" />
        <Section title="Riesgos" body={draft.risks} placeholder="generando…" />

        {draft.subtaskBreakdown && draft.subtaskBreakdown.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Subtareas técnicas</div>
            <ul className={styles.subtaskList}>
              {draft.subtaskBreakdown.map((s, i) => (
                <li key={i} className={styles.subtask}>
                  <label>
                    <input
                      type="checkbox"
                      checked={includedSubtasks.has(i)}
                      onChange={() => toggleSubtask(i)}
                      disabled={draft.status !== 'READY' || !canPublish}
                    />
                    <span>
                      <p className={styles.subTitle}>
                        {s.title}
                        {s.priority && s.priority !== 'MEDIUM' && (
                          <span style={{
                            marginLeft: '0.5rem',
                            fontSize: '0.7rem',
                            letterSpacing: '0.1em',
                            color: 'var(--accent-ink)',
                          }}>· {s.priority}</span>
                        )}
                      </p>
                      {s.description && <p className={styles.subDesc}>{s.description}</p>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {draft.filesToTouch && draft.filesToTouch.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Archivos a tocar</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {draft.filesToTouch.map((f, i) => (
                <li key={i} style={{ padding: '0.4rem 0', borderTop: '1px dotted var(--rule)' }}>
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>{f.path}</code>
                  <span style={{ marginLeft: '0.6rem', color: 'var(--color-fg-muted)' }}>— {f.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <aside className={styles.viewerSide}>
        <div className={`${styles.streamStatus} ${draft.status === 'GENERATING' ? styles.live : ''}`}>
          {draft.status === 'GENERATING' && '◌ generando…'}
          {draft.status === 'READY' && '✓ listo'}
          {draft.status === 'PUBLISHED' && '◆ publicado'}
          {draft.status === 'ERRORED' && '✕ error'}
        </div>

        {draft.errorMessage && (
          <p style={{ color: 'var(--accent-ink)', fontSize: '0.85rem' }}>
            {draft.errorMessage}
          </p>
        )}

        {draft.status === 'READY' && (
          <>
            <div>
              <label className={styles.fieldLabel}>Tokens</label>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                ↓ {draft.inputTokens} · ↑ {draft.outputTokens}
              </div>
            </div>
            <div>
              <label className={styles.fieldLabel}>Costo</label>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontStyle: 'italic' }}>
                ${draft.estimatedCostUsd}
              </div>
            </div>
            <div>
              <label className={styles.fieldLabel}>Tiempo</label>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                {(draft.durationMs / 1000).toFixed(1)}s
              </div>
            </div>
          </>
        )}

        {draft.status === 'READY' && canPublish && (
          <>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="publishState">Publicar en columna</label>
              <select
                id="publishState"
                className={styles.select}
                value={stateId}
                onChange={(e) => setStateId(e.target.value)}
              >
                {states.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            {publishError && (
              <p style={{ color: 'var(--accent-ink)', fontSize: '0.85rem' }}>{publishError}</p>
            )}
            <button
              type="button"
              className={styles.generateBtn}
              onClick={onPublish}
              disabled={pending}
            >
              {pending ? 'Publicando…' : 'Publicar como tarea'}
            </button>
          </>
        )}

        {draft.taskId && (
          <p style={{ color: 'var(--accent-ink)', fontSize: '0.85rem' }}>
            ✓ Publicado como tarea
          </p>
        )}

        {draft.citedMemoryIds.length > 0 && (
          <div>
            <label className={styles.fieldLabel}>
              Memorias citadas ({draft.citedMemoryIds.length})
            </label>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.75rem' }}>
              {draft.citedMemoryIds.map((id) => (
                <li key={id} style={{ fontFamily: 'var(--font-mono)' }}>
                  M-{id.slice(0, 8)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}

function Section({
  title,
  body,
  placeholder,
}: {
  title: string;
  body: string | null;
  placeholder: string;
}) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>{title}</div>
      <div className={styles.sectionBody}>
        {body ? (
          <RenderMarkdown source={body} />
        ) : (
          <em style={{ color: 'var(--color-fg-muted)' }}>{placeholder}</em>
        )}
      </div>
    </div>
  );
}

function RenderMarkdown({ source }: { source: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>;
}
