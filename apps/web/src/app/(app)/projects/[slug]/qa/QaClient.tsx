'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { useI18n } from '@/lib/i18n/i18n';
import { generateQaTestsAction, qaDecisionAction, type QaTaskView } from '@/lib/actions/qa';
import type { QaTestCase } from '@/lib/qa-types';

const card: React.CSSProperties = {
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  background: 'var(--color-surface)',
  marginBottom: '1rem',
  overflow: 'hidden',
};
const head: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.6rem',
  padding: '0.8rem 1rem',
  cursor: 'pointer',
  width: '100%',
  background: 'none',
  border: 'none',
  textAlign: 'left',
  color: 'var(--color-fg)',
};
const body: React.CSSProperties = { padding: '0 1rem 1rem' };
const sectionTitle: React.CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 700,
  margin: '1rem 0 0.4rem',
  color: 'var(--color-fg)',
};
const muted: React.CSSProperties = { color: 'var(--color-fg-muted)', fontSize: '0.85rem', whiteSpace: 'pre-wrap' };
const num: React.CSSProperties = { fontFamily: 'var(--font-mono)', color: 'var(--color-fg-muted)', fontSize: '0.85rem' };

function TestList({ tests }: { tests: QaTestCase[] }) {
  return (
    <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      {tests.map((tc, i) => (
        <li key={i} style={{ fontSize: '0.86rem' }}>
          <strong>{tc.title}</strong>
          {tc.steps ? <div style={muted}>{tc.steps}</div> : null}
          {tc.expected ? (
            <div style={{ ...muted, fontStyle: 'italic' }}>→ {tc.expected}</div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function QaCard({
  slug,
  canWrite,
  task,
  onUpdate,
  onResolved,
}: {
  slug: string;
  canWrite: boolean;
  task: QaTaskView;
  onUpdate: (t: QaTaskView) => void;
  onResolved: (id: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [genBusy, startGen] = useTransition();
  const [decideBusy, startDecide] = useTransition();

  function generate() {
    setError(null);
    startGen(async () => {
      const r = await generateQaTestsAction(slug, task.id);
      if (!r.ok) setError(r.error);
      else if (r.data) onUpdate(r.data);
    });
  }
  function decide(decision: 'approve' | 'reject') {
    setError(null);
    if (decision === 'reject' && !comment.trim()) {
      setError(t('Indica el motivo del rechazo', 'Enter a reason for the rejection'));
      return;
    }
    startDecide(async () => {
      const r = await qaDecisionAction(slug, task.id, decision, comment.trim() || undefined);
      if (!r.ok) setError(r.error);
      else onResolved(task.id);
    });
  }

  const h = task.handoff;
  const busy = genBusy || decideBusy;

  return (
    <section style={card}>
      <button type="button" style={head} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span aria-hidden style={{ transition: 'transform .15s', transform: open ? 'rotate(90deg)' : 'none' }}>▸</span>
        <span style={num}>PROJ-{task.taskNumber}</span>
        <span style={{ fontWeight: 600, flex: 1 }}>{task.title}</span>
        {task.assignee?.name ? <span style={muted}>👤 {task.assignee.name}</span> : null}
        <span style={muted}>💬 {task.commentCount}</span>
      </button>

      {open && (
        <div style={body}>
          {task.description ? <p style={muted}>{task.description}</p> : null}

          <div style={sectionTitle}>{t('Criterios de aceptación', 'Acceptance criteria')}</div>
          {task.acceptanceCriteria ? (
            <div style={muted}>{task.acceptanceCriteria}</div>
          ) : (
            <div style={muted}>{t('(no especificados)', '(not specified)')}</div>
          )}

          {h ? (
            <>
              <div style={sectionTitle}>{t('Entrega del desarrollo (Qwen)', 'Development handoff (Qwen)')}</div>
              {h.criteria.length ? (
                <ul style={{ margin: '0 0 0.5rem', paddingLeft: '1.1rem' }}>
                  {h.criteria.map((c, i) => (
                    <li key={i} style={{ fontSize: '0.86rem' }}>
                      {c.met ? '✅' : '❌'} {c.text}
                    </li>
                  ))}
                </ul>
              ) : null}
              {h.suggestedTests.length ? (
                <>
                  <div style={{ ...sectionTitle, marginTop: '0.6rem' }}>
                    {t('Pruebas sugeridas por el desarrollo', 'Tests suggested by development')}
                  </div>
                  <TestList tests={h.suggestedTests} />
                </>
              ) : null}
              {h.executedTasks.length ? (
                <>
                  <div style={{ ...sectionTitle, marginTop: '0.6rem' }}>{t('Tareas ejecutadas', 'Executed tasks')}</div>
                  <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                    {h.executedTasks.map((x, i) => (
                      <li key={i} style={{ fontSize: '0.86rem' }}>{x}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {h.notes ? (
                <>
                  <div style={{ ...sectionTitle, marginTop: '0.6rem' }}>{t('Notas / contexto', 'Notes / context')}</div>
                  <div style={muted}>{h.notes}</div>
                </>
              ) : null}
            </>
          ) : (
            <div style={{ ...muted, marginTop: '0.6rem' }}>
              {t('El desarrollo aún no dejó un handoff estructurado (pruebas sugeridas / tareas ejecutadas).', 'Development has not left a structured handoff yet (suggested tests / executed tasks).')}
            </div>
          )}

          <div style={sectionTitle}>{t('Mis pruebas de QA', 'My QA tests')}</div>
          {task.qaTests && task.qaTests.tests.length ? (
            <TestList tests={task.qaTests.tests} />
          ) : (
            <div style={muted}>{t('Aún no generaste pruebas.', 'You have not generated tests yet.')}</div>
          )}
          {canWrite && (
            <div style={{ marginTop: '0.5rem' }}>
              <Button variant="secondary" onClick={generate} disabled={busy}>
                {genBusy
                  ? t('Generando…', 'Generating…')
                  : task.qaTests
                    ? t('Regenerar pruebas de QA (IA)', 'Regenerate QA tests (AI)')
                    : t('Generar pruebas de QA (IA)', 'Generate QA tests (AI)')}
              </Button>
            </div>
          )}

          {canWrite && (
            <>
              <div style={sectionTitle}>{t('Veredicto', 'Verdict')}</div>
              <textarea
                rows={2}
                value={comment}
                placeholder={t('Comentario (obligatorio al rechazar)…', 'Comment (required when rejecting)…')}
                onChange={(e) => setComment(e.target.value)}
                style={{
                  width: '100%',
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                  background: 'var(--color-bg)',
                  color: 'var(--color-fg)',
                  padding: '0.5rem',
                  fontFamily: 'var(--font-sans)',
                  fontSize: '0.86rem',
                }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: '0.5rem' }}>
                <Button variant="primary" onClick={() => decide('approve')} disabled={busy}>
                  {decideBusy ? t('Guardando…', 'Saving…') : t('✓ Aprobar', '✓ Approve')}
                </Button>
                <Button variant="secondary" onClick={() => decide('reject')} disabled={busy}>
                  {t('✗ Rechazar', '✗ Reject')}
                </Button>
              </div>
            </>
          )}
          {error && <p style={{ color: 'var(--color-danger)', marginTop: '0.5rem' }}>{error}</p>}
        </div>
      )}
    </section>
  );
}

export function QaClient({
  slug,
  canWrite,
  initialQueue,
}: {
  slug: string;
  canWrite: boolean;
  initialQueue: QaTaskView[];
}) {
  const { t } = useI18n();
  const [queue, setQueue] = useState(initialQueue);

  function update(updated: QaTaskView) {
    setQueue((q) => q.map((x) => (x.id === updated.id ? updated : x)));
  }
  function resolved(id: string) {
    setQueue((q) => q.filter((x) => x.id !== id));
  }

  if (queue.length === 0) {
    return (
      <p style={{ color: 'var(--color-fg-muted)' }}>
        {t('No hay historias en Verificación. Cuando el desarrollo cierre una HU, aparecerá aquí.', 'No stories in Verification. When development closes a story, it will appear here.')}{' '}
        <Link href={`/projects/${slug}/board`}>{t('Ver el tablero →', 'Open the board →')}</Link>
      </p>
    );
  }

  return (
    <div>
      {queue.map((task) => (
        <QaCard key={task.id} slug={slug} canWrite={canWrite} task={task} onUpdate={update} onResolved={resolved} />
      ))}
    </div>
  );
}
