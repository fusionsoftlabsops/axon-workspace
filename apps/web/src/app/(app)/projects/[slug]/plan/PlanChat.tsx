'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Badge, Card } from '@/components/ui';
import { useI18n } from '@/lib/i18n/i18n';
import {
  planChatAction,
  startPlanGenerationAction,
  publishPlanAction,
  addPlanLinkAction,
  removePlanAttachmentAction,
  type PlanView,
} from '@/lib/actions/planning';
import type { GeneratedPlan } from '@/lib/ai/plan-schema';
import { PlanTaskCard, PlanSprintHead } from './PlanEditors';
import styles from './plan.module.scss';

export function PlanChat({
  slug,
  canWrite,
  initialPlan,
}: {
  slug: string;
  canWrite: boolean;
  initialPlan: PlanView;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [plan, setPlan] = useState<PlanView>(initialPlan);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  const [generating, setGenerating] = useState(initialPlan.status === 'GENERATING');
  const [publishing, startPublish] = useTransition();
  const [linkUrl, setLinkUrl] = useState('');
  const [attaching, setAttaching] = useState(false);
  const msgRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const generated: GeneratedPlan | null = plan.generated;
  const published = plan.status === 'PUBLISHED';
  const showPreview = generating || !!generated;
  const canEdit = canWrite && !published && plan.status === 'READY' && !generating;

  useEffect(() => {
    msgRef.current?.scrollTo({ top: msgRef.current.scrollHeight });
  }, [plan.messages]);

  // Poll while the plan is generating.
  useEffect(() => {
    if (!generating) return;
    let alive = true;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/v1/projects/${slug}/plan`, { cache: 'no-store' });
        const j = await r.json();
        const p = j.plan;
        if (!alive || !p) return;
        if (p.status === 'READY' || p.status === 'FAILED' || p.status === 'PUBLISHED') {
          setGenerating(false);
          setPlan((prev) => ({
            ...prev,
            status: p.status,
            generated: p.generated ?? null,
            improvedIdea: p.improvedIdea ?? null,
            error: p.error ?? null,
          }));
          if (p.status === 'FAILED') setError(p.error ?? t('Falló la generación', 'Generation failed'));
        }
      } catch {
        /* transient — keep polling */
      }
    }, 2500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [generating, slug, t]);

  function send() {
    const text = input.trim();
    if (!text || sending) return;
    setError(null);
    setInput('');
    setPlan((prev) => ({ ...prev, messages: [...prev.messages, { role: 'user', content: text }] }));
    startSend(async () => {
      const r = await planChatAction(slug, text);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (r.data) setPlan(r.data);
    });
  }

  function generate() {
    setError(null);
    startSend(async () => {
      const r = await startPlanGenerationAction(slug);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setPlan((prev) => ({ ...prev, status: 'GENERATING' }));
      setGenerating(true);
    });
  }

  function publish() {
    startPublish(async () => {
      const r = await publishPlanAction(slug);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/projects/${slug}/roadmap`);
      router.refresh();
    });
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setAttaching(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('file', f));
      const r = await fetch(`/api/v1/projects/${slug}/plan/attachments`, { method: 'POST', body: fd });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j.error ?? t('No se pudo subir el archivo', 'Could not upload the file'));
      } else {
        const j = await fetch(`/api/v1/projects/${slug}/plan`, { cache: 'no-store' }).then((x) => x.json());
        if (j.plan?.attachments) setPlan((prev) => ({ ...prev, attachments: j.plan.attachments }));
      }
    } finally {
      setAttaching(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function addLink() {
    const url = linkUrl.trim();
    if (!url || attaching) return;
    setError(null);
    setAttaching(true);
    startSend(async () => {
      const r = await addPlanLinkAction(slug, url);
      setAttaching(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setLinkUrl('');
      if (r.data) setPlan(r.data);
    });
  }

  function removeAttachment(id: string) {
    setError(null);
    startSend(async () => {
      const r = await removePlanAttachmentAction(slug, id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (r.data) setPlan(r.data);
    });
  }

  const attachIcon = (kind: PlanView['attachments'][number]['kind']) =>
    kind === 'IMAGE' ? '🖼' : kind === 'LINK' ? '🔗' : '📄';

  return (
    <div className={`${styles.layout} ${showPreview ? styles.withPreview : ''}`}>
      {/* ---- Chat ---- */}
      <div>
        {published && (
          <Card className={styles.idea} style={{ marginBottom: '1rem' }}>
            ✓ {t('Plan publicado al tablero.', 'Plan published to the board.')}{' '}
            <Link href={`/projects/${slug}/board`}>{t('Ir al tablero', 'Go to board')}</Link> ·{' '}
            <Link href={`/projects/${slug}/roadmap`}>{t('Ver roadmap', 'View roadmap')}</Link>
          </Card>
        )}
        <div className={styles.chat}>
          <div className={styles.messages} ref={msgRef}>
            {plan.messages.map((m, i) => (
              <div
                key={i}
                className={`${styles.msg} ${m.role === 'assistant' ? styles.assistant : styles.user}`}
              >
                {m.content}
              </div>
            ))}
            {sending && <div className={`${styles.msg} ${styles.assistant}`}>…</div>}
          </div>
          {canWrite && !published && (
            <div className={styles.composer}>
              <textarea
                className={styles.input}
                rows={2}
                value={input}
                placeholder={t('Escribe tu respuesta…', 'Type your answer…')}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <Button variant="secondary" onClick={send} disabled={sending || !input.trim()}>
                {t('Enviar', 'Send')}
              </Button>
            </div>
          )}
        </div>
        {canWrite && !published && (
          <div className={styles.attachments}>
            <div className={styles.attachHead}>
              <span className={styles.attachTitle}>{t('Contexto adjunto', 'Attached context')}</span>
              <span className={styles.attachHint}>
                {t(
                  'Imágenes, PDF, texto y enlaces. El asistente los tendrá en cuenta.',
                  'Images, PDF, text and links. The assistant will take them into account.',
                )}
              </span>
            </div>

            {plan.attachments.length > 0 && (
              <ul className={styles.attachList}>
                {plan.attachments.map((a) => (
                  <li key={a.id} className={styles.attachItem}>
                    <span className={styles.attachIcon}>{attachIcon(a.kind)}</span>
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noreferrer" className={styles.attachName}>
                        {a.name}
                      </a>
                    ) : (
                      <span className={styles.attachName}>{a.name}</span>
                    )}
                    <button
                      type="button"
                      className={styles.attachRemove}
                      onClick={() => removeAttachment(a.id)}
                      disabled={sending}
                      aria-label={t('Quitar', 'Remove')}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className={styles.attachActions}>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/*,.md,.csv,.json,.yaml,.yml,.log"
                className={styles.fileInput}
                onChange={(e) => uploadFiles(e.target.files)}
                disabled={attaching}
              />
              <Button
                variant="secondary"
                onClick={() => fileRef.current?.click()}
                disabled={attaching}
              >
                {attaching ? t('Subiendo…', 'Uploading…') : t('Añadir archivos', 'Add files')}
              </Button>
              <input
                className={styles.linkInput}
                type="url"
                value={linkUrl}
                placeholder={t('Pega un enlace (https://…)', 'Paste a link (https://…)')}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addLink();
                  }
                }}
                disabled={attaching}
              />
              <Button variant="secondary" onClick={addLink} disabled={attaching || !linkUrl.trim()}>
                {t('Añadir enlace', 'Add link')}
              </Button>
            </div>
          </div>
        )}
        {!published && (
          <div className={styles.toolbar}>
            {canWrite && (
              <Button variant="primary" onClick={generate} disabled={sending || generating}>
                {generating ? t('Generando…', 'Generating…') : t('Generar plan', 'Generate plan')}
              </Button>
            )}
            <Link className={styles.skip} href={`/projects/${slug}/board`}>
              {t('Saltar al tablero', 'Skip to board')}
            </Link>
            {error && <span className={styles.error}>{error}</span>}
          </div>
        )}
      </div>

      {/* ---- Preview ---- */}
      {showPreview && (
        <div className={styles.preview}>
          {generating && (
            <div className={styles.generating}>
              {t('Generando el plan con Claude Opus…', 'Generating the plan with Claude Opus…')}
            </div>
          )}
          {generated && !generating && (
            <>
              {generated.improvedIdea && (
                <div>
                  <h3>{t('Idea afinada', 'Refined idea')}</h3>
                  <p className={styles.idea}>{generated.improvedIdea}</p>
                </div>
              )}
              {generated.sprints.map((s, si) => (
                <div key={si} className={styles.sprint}>
                  <PlanSprintHead
                    slug={slug}
                    sprintIndex={si}
                    name={s.name}
                    goal={s.goal}
                    canEdit={canEdit}
                    onChange={setPlan}
                    onError={setError}
                  />
                  {s.tasks.map((tk, ti) => (
                    <PlanTaskCard
                      key={ti}
                      slug={slug}
                      sprintIndex={si}
                      taskIndex={ti}
                      task={tk}
                      canEdit={canEdit}
                      onChange={setPlan}
                      onError={(m) => setError(m || null)}
                    />
                  ))}
                </div>
              ))}
              {generated.suggestedRepos?.length > 0 && (
                <div>
                  <h3>{t('Repositorios sugeridos', 'Suggested repositories')}</h3>
                  <div className={styles.repos}>
                    {generated.suggestedRepos.map((r, ri) => (
                      <div key={ri} className={styles.repoCard}>
                        <div className={styles.repoName}>
                          {r.name} <Badge tone="neutral">{r.kind}</Badge>
                        </div>
                        {r.stack && <p className={styles.repoReason}>{r.stack}</p>}
                        {r.reason && <p className={styles.repoReason}>{r.reason}</p>}
                      </div>
                    ))}
                  </div>
                  <p className={styles.repoReason}>
                    {t(
                      'Créalos y pega la URL en Ajustes → Repositorio.',
                      'Create them and paste the URL in Settings → Repository.',
                    )}
                  </p>
                </div>
              )}
              {canWrite && !published && (
                <div className={styles.publishBar}>
                  <Button variant="primary" onClick={publish} disabled={publishing}>
                    {publishing ? t('Publicando…', 'Publishing…') : t('Publicar al tablero', 'Publish to board')}
                  </Button>
                  <Button variant="secondary" onClick={generate} disabled={generating}>
                    {t('Regenerar', 'Regenerate')}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
