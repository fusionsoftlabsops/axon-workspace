'use client';

import { useState, useTransition } from 'react';
import { invokeAiAction } from '@/lib/actions/ai';
import { useI18n } from '@/lib/i18n/i18n';
import type { AiPurpose } from '@admin/shared/types';

function labelsFor(t: <T>(es: T, en: T) => T): Record<AiPurpose, string> {
  return {
    'task.draft': t('Redactar descripción', 'Draft description'),
    'task.summarize': t('Resumir', 'Summarize'),
    'ac.generate': t('Generar criterios de aceptación', 'Generate acceptance criteria'),
    'epic.breakdown': t('Dividir en subtareas', 'Break down into subtasks'),
    'commit.message': t('Mensaje de commit', 'Commit message'),
    'pr.description': t('Descripción de PR', 'PR description'),
    'bug.report': t('Convertir a bug report', 'Convert to bug report'),
    'brain.extract': t('Extraer memorias del cerebro', 'Extract memories from the brain'),
    'story.generate': t('Generar Historia de Usuario', 'Generate User Story'),
  };
}

export function AiAssist({
  projectSlug,
  purposes,
  context,
  onResult,
}: {
  projectSlug: string;
  purposes: AiPurpose[];
  context: string;
  onResult?: (output: string) => void;
}) {
  const { t } = useI18n();
  const LABELS = labelsFor(t);
  const [pending, startTransition] = useTransition();
  const [output, setOutput] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ model: string; cost: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function invoke(purpose: AiPurpose) {
    setError(null);
    setOutput(null);
    setMeta(null);
    startTransition(async () => {
      const r = await invokeAiAction(projectSlug, { purpose, context });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOutput(r.output);
      setMeta({ model: r.model, cost: r.estimatedCostUsd });
      onResult?.(r.output);
    });
  }

  return (
    <div
      style={{
        padding: '1rem',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '8px',
        marginTop: '0.5rem',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
        {purposes.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => invoke(p)}
            disabled={pending || context.trim().length === 0}
            style={{
              padding: '0.4rem 0.75rem',
              border: '1px solid var(--color-border)',
              borderRadius: '6px',
              background: 'var(--color-bg)',
              color: 'var(--color-fg)',
              fontSize: '0.8rem',
              cursor: 'pointer',
            }}
          >
            ✨ {LABELS[p]}
          </button>
        ))}
      </div>

      {pending && (
        <p style={{ color: 'var(--color-fg-muted)', fontSize: '0.85rem' }}>{t('Pensando…', 'Thinking…')}</p>
      )}
      {error && (
        <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>{error}</p>
      )}
      {output && (
        <>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit',
              background: 'var(--color-bg)',
              padding: '0.75rem',
              borderRadius: '4px',
              border: '1px solid var(--color-border)',
              fontSize: '0.85rem',
              maxHeight: '320px',
              overflow: 'auto',
            }}
          >
            {output}
          </pre>
          {meta && (
            <p style={{ fontSize: '0.7rem', color: 'var(--color-fg-subtle)', marginTop: '0.4rem' }}>
              {meta.model} · ${meta.cost.toFixed(5)} USD
            </p>
          )}
        </>
      )}
    </div>
  );
}
