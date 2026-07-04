'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge, Button, Modal } from '@/components/ui';
import { useI18n } from '@/lib/i18n/i18n';
import {
  getTaskDetailAction,
  generateTaskImplPlanAction,
  type TaskDetailView,
} from '@/lib/actions/impl-plan';

/**
 * Detalle de una HU del tablero (abierto con ?task=<id>). Muestra la HU y su
 * PLAN DE IMPLEMENTACIÓN: generado por el agente Dev al tomar la HU, o a mano
 * con el botón. La acción queda visible acá (badge + fecha + markdown).
 */
export function TaskDrawer({ slug, canWrite }: { slug: string; canWrite: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const taskId = params.get('task');

  const [detail, setDetail] = useState<TaskDetailView | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) {
      setDetail(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    getTaskDetailAction(slug, taskId).then((res) => {
      if (!alive) return;
      setLoading(false);
      if (res.ok) setDetail(res.data ?? null);
      else setError(res.error);
    });
    return () => {
      alive = false;
    };
  }, [slug, taskId]);

  function close() {
    router.push(`/projects/${slug}/board`, { scroll: false });
  }

  async function generate() {
    if (!taskId) return;
    setBusy(true);
    setError(null);
    const res = await generateTaskImplPlanAction(slug, taskId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDetail((d) => (d ? { ...d, implPlan: res.data!.implPlan, implPlanAt: res.data!.implPlanAt } : d));
  }

  const open = !!taskId;
  const hasPlan = !!detail?.implPlan;

  return (
    <Modal
      open={open}
      onClose={close}
      title={detail ? `#${detail.taskNumber} · ${detail.title}` : t('Historia de usuario', 'User story')}
    >
      {loading && <p style={{ opacity: 0.7 }}>{t('Cargando…', 'Loading…')}</p>}
      {error && <p style={{ color: 'var(--bad, #e5484d)' }}>{error}</p>}

      {detail && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge tone="neutral">{detail.state}</Badge>
            {detail.assignee && <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>👤 {detail.assignee}</span>}
          </div>

          {detail.description && (
            <section>
              <h4 style={{ margin: '0 0 0.3rem', fontSize: '0.8rem', textTransform: 'uppercase', opacity: 0.6 }}>
                {t('Descripción', 'Description')}
              </h4>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.9rem', lineHeight: 1.5 }}>{detail.description}</p>
            </section>
          )}

          {detail.acceptanceCriteria && (
            <section>
              <h4 style={{ margin: '0 0 0.3rem', fontSize: '0.8rem', textTransform: 'uppercase', opacity: 0.6 }}>
                {t('Criterios de aceptación', 'Acceptance criteria')}
              </h4>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.9rem', lineHeight: 1.5 }}>
                {detail.acceptanceCriteria}
              </p>
            </section>
          )}

          <section data-testid="impl-plan-section">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
              <h4 style={{ margin: 0, fontSize: '0.8rem', textTransform: 'uppercase', opacity: 0.6 }}>
                {t('Plan de implementación', 'Implementation plan')}
              </h4>
              {hasPlan && <Badge tone="ok">{t('Generado', 'Generated')}</Badge>}
            </div>

            {hasPlan && detail.implPlanAt && (
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', opacity: 0.55 }}>
                {t('Generado', 'Generated')} {new Date(detail.implPlanAt).toLocaleString()}
              </p>
            )}

            {hasPlan ? (
              <pre
                data-testid="impl-plan-content"
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: '0.82rem',
                  lineHeight: 1.5,
                  maxHeight: '40vh',
                  overflowY: 'auto',
                  padding: '0.75rem',
                  border: '1px solid var(--border, rgba(127,127,127,0.22))',
                  borderRadius: 8,
                  margin: '0 0 0.6rem',
                  fontFamily: 'inherit',
                }}
              >
                {detail.implPlan}
              </pre>
            ) : (
              <p style={{ margin: '0 0 0.6rem', fontSize: '0.85rem', opacity: 0.7 }}>
                {t(
                  'Todavía no hay plan. El agente Dev lo genera al tomar la HU, o generalo vos para darle mejor contexto.',
                  'No plan yet. The Dev agent generates it when it picks up the story, or generate it yourself for better context.',
                )}
              </p>
            )}

            {canWrite && (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void generate()}>
                {busy
                  ? t('Generando… (puede tardar)', 'Generating… (may take a while)')
                  : hasPlan
                    ? t('⚙ Regenerar plan', '⚙ Regenerate plan')
                    : t('⚙ Generar plan de implementación', '⚙ Generate implementation plan')}
              </Button>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
