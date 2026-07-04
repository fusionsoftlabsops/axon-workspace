'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, Markdown } from '@/components/ui';
import { useI18n } from '@/lib/i18n/i18n';
import {
  planChatAction,
  planTypingAction,
  clearPlanChatAction,
  setChatColorAction,
  startPlanGenerationAction,
  publishPlanAction,
  addPlanLinkAction,
  removePlanAttachmentAction,
  reestimatePlanAction,
  type PlanView,
} from '@/lib/actions/planning';
import type { GeneratedPlan } from '@/lib/ai/plan-schema';
import { effectiveColor, contrastText } from '@/lib/plan-colors';
import { PlanTaskCard, PlanSprintHead } from './PlanEditors';
import { PlanRepos } from './PlanRepos';
import { PlanContext, type ContextFile } from './PlanContext';
import { ChatColors } from './ChatColors';
import { PlanProgress } from './PlanProgress';
import styles from './plan.module.scss';

export function PlanChat({
  slug,
  canWrite,
  currentUserId,
  currentUserName,
  initialPlan,
  contextFiles = [],
  members = [],
}: {
  slug: string;
  canWrite: boolean;
  currentUserId?: string;
  currentUserName?: string;
  initialPlan: PlanView;
  contextFiles?: ContextFile[];
  members?: { userId: string; name: string }[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [plan, setPlan] = useState<PlanView>(initialPlan);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  const [generating, setGenerating] = useState(initialPlan.status === 'GENERATING');
  const [progress, setProgress] = useState(initialPlan.progress);
  const [heartbeatAt, setHeartbeatAt] = useState(initialPlan.heartbeatAt);
  const [publishing, startPublish] = useTransition();
  const [linkUrl, setLinkUrl] = useState('');
  const [attaching, setAttaching] = useState(false);
  const [openSprints, setOpenSprints] = useState<Set<number>>(new Set()); // accordion: all closed by default
  const [reestimating, setReestimating] = useState(false);
  // Realtime collaboration: connection state, who's typing, who's present.
  const [connected, setConnected] = useState(false);
  const [typingName, setTypingName] = useState<string | null>(null);
  const [presence, setPresence] = useState<{ userId: string; name: string }[]>([]);
  // Per-user chat colors (shared per project, synced live).
  const [chatColors, setChatColors] = useState<Record<string, string>>(initialPlan.chatColors ?? {});
  const msgRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);

  const generated: GeneratedPlan | null = plan.generated;
  const published = plan.status === 'PUBLISHED';
  const showPreview = generating || !!generated;
  const canEdit = canWrite && !published && plan.status === 'READY' && !generating;
  // Generating an HU's implementation plan is a read-only action, useful whenever
  // the HU cards are on screen — i.e. whenever a generated plan exists (READY,
  // published, or CHATTING after a further message) and we're not mid-generation.
  const canGenImpl = canWrite && !generating && !!generated;

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
        if (r.status === 401) {
          window.location.assign('/login'); // session expired while the page was open
          return;
        }
        const j = await r.json();
        const p = j.plan;
        if (!alive || !p) return;
        if (p.status === 'READY' || p.status === 'FAILED' || p.status === 'PUBLISHED') {
          setGenerating(false);
          setProgress(null);
          setPlan((prev) => ({
            ...prev,
            status: p.status,
            generated: p.generated ?? null,
            improvedIdea: p.improvedIdea ?? null,
            error: p.error ?? null,
          }));
          if (p.status === 'FAILED') setError(p.error ?? t('Falló la generación', 'Generation failed'));
        } else if (p.status === 'GENERATING') {
          // Mirror live phase + heartbeat so the progress UI advances.
          const prog =
            p.stats && typeof p.stats === 'object' && typeof p.stats.phase === 'string'
              ? { phase: p.stats.phase, startedAt: p.stats.startedAt }
              : null;
          setProgress(prog);
          setHeartbeatAt(p.heartbeatAt ?? null);
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

  // Collaborative realtime: subscribe to the plan's SSE stream for live messages,
  // typing indicators and presence. A 'message' event just nudges a refetch of
  // the authoritative messages (avoids client-side dedup); typing/presence are
  // ephemeral UI state.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    const es = new EventSource(`/api/v1/projects/${slug}/plan/stream`);
    es.onopen = () => setConnected(true);

    const refresh = async () => {
      try {
        const r = await fetch(`/api/v1/projects/${slug}/plan`, { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (Array.isArray(j.plan?.messages)) {
          setPlan((prev) => ({ ...prev, messages: j.plan.messages }));
        }
      } catch {
        /* transient */
      }
    };

    es.onmessage = (ev) => {
      let data: { type?: string; userId?: string; name?: string; state?: string; colors?: Record<string, string> };
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (data.type === 'message') {
        void refresh();
      } else if (data.type === 'colors' && data.colors) {
        setChatColors(data.colors);
      } else if (data.type === 'typing') {
        if (data.userId && data.userId !== currentUserId) {
          setTypingName(data.name || t('Alguien', 'Someone'));
          if (typingTimer.current) clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setTypingName(null), 3000);
        }
      } else if (data.type === 'presence' && data.userId && data.userId !== currentUserId) {
        setPresence((prev) => {
          const others = prev.filter((p) => p.userId !== data.userId);
          return data.state === 'leave' ? others : [...others, { userId: data.userId!, name: data.name || '' }];
        });
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects; reflect the interim disconnect.
      setConnected(false);
    };

    return () => {
      es.close();
      setConnected(false);
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, [slug, currentUserId, t]);

  // Throttled "typing" ping while the user composes a message.
  function pingTyping() {
    if (!canWrite) return;
    const now = Date.now();
    if (now - lastTypingSent.current < 2000) return;
    lastTypingSent.current = now;
    void planTypingAction(slug);
  }

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
      setProgress({ phase: 'starting', startedAt: new Date().toISOString() });
      setHeartbeatAt(new Date().toISOString());
      setGenerating(true);
    });
  }

  function clearChat() {
    if (!confirm(t('¿Reiniciar la conversación? Se borra el historial del chat (el plan generado se conserva).', 'Restart the conversation? The chat history is cleared (the generated plan is kept).'))) return;
    setError(null);
    startSend(async () => {
      const r = await clearPlanChatAction(slug);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (r.data) setPlan(r.data);
    });
  }

  function reestimate() {
    setError(null);
    setReestimating(true);
    reestimatePlanAction(slug)
      .then((r) => {
        if (!r.ok) setError(r.error);
        else if (r.data) setPlan(r.data);
      })
      .finally(() => setReestimating(false));
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

  // Everyone connected to the live chat, including you.
  const onlineNames: string[] = [
    currentUserName ? `${currentUserName} (${t('vos', 'you')})` : t('Vos', 'You'),
    ...presence.map((p) => p.name || t('Anónimo', 'Anonymous')),
  ];

  return (
    <div className={`${styles.layout} ${showPreview ? styles.withPreview : ''}`}>
      {/* ---- Chat ---- */}
      <div>
        {published && (
          <Card className={styles.idea} style={{ marginBottom: '1rem' }}>
            ✓ {t('Plan publicado al tablero.', 'Plan published to the board.')}{' '}
            <Link href={`/projects/${slug}/board`}>{t('Ir al tablero', 'Go to board')}</Link> ·{' '}
            <Link href={`/projects/${slug}/roadmap`}>{t('Ver roadmap', 'View roadmap')}</Link> ·{' '}
            <Link href={`/projects/${slug}/develop`}>{t('▶ Trabajá las HU con Fusion Code', '▶ Work the stories with Fusion Code')}</Link>
          </Card>
        )}
        <div className={styles.chatRow}>
          <div className={styles.chat}>
            <details data-testid="agent-chat-tips" style={{ fontSize: '0.78rem', margin: '0 0.25rem 0.5rem', opacity: 0.92 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                {t('💡 Tips: chateá con los agentes del equipo (@menciones)', '💡 Tips: chat with the team agents (@mentions)')}
              </summary>
              <div style={{ padding: '0.5rem 0.25rem 0.2rem', lineHeight: 1.55 }}>
                <p style={{ margin: '0 0 0.35rem' }}>
                  {t(
                    'Mencioná a un agente y responde EN PERSONA, con su lente de especialista y su modelo configurado:',
                    'Mention an agent and it replies IN PERSONA, with its specialist lens and configured model:',
                  )}
                </p>
                <ul style={{ margin: '0 0 0.45rem', paddingLeft: '1.2rem' }}>
                  <li><code>@dax</code> — {t('arquitectura y descomposición técnica (trade-offs, riesgos)', 'architecture & technical decomposition (trade-offs, risks)')}</li>
                  <li><code>@iris</code> — {t('valor de negocio, alcance y criterios de aceptación', 'business value, scope and acceptance criteria')}</li>
                  <li><code>@aria</code> — {t('UI/UX: layout, componentes, estados, accesibilidad', 'UI/UX: layout, components, states, accessibility')}</li>
                  <li><code>@kai</code> — {t('implementabilidad y esfuerzo real de desarrollo', 'implementability and real dev effort')}</li>
                  <li><code>@vera</code> — {t('cómo se rompe: casos borde y testeabilidad', 'how it breaks: edge cases and testability')}</li>
                  <li><code>@sol</code> — {t('branding, SEO y go-to-market', 'branding, SEO and go-to-market')}</li>
                  <li><code>@nova</code> / <code>@ren</code> / <code>@marco</code> — {t('flujo del backlog · calidad de código · despliegue', 'backlog flow · code quality · deployment')}</li>
                </ul>
                <p style={{ margin: '0 0 0.25rem', fontWeight: 600 }}>{t('Ejemplos:', 'Examples:')}</p>
                <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                  <li>{t('«@dax ¿cómo descompondrías el módulo de inventario en microservicios?»', '"@dax how would you split the inventory module into microservices?"')}</li>
                  <li>{t('«@iris ¿qué criterios de aceptación le pondrías al checkout?»', '"@iris what acceptance criteria would you set for checkout?"')}</li>
                  <li>{t('«@aria ¿cómo debería verse el dashboard en móvil?»', '"@aria how should the dashboard look on mobile?"')}</li>
                  <li>{t('«@vera ¿qué casos borde ves en la carga masiva de productos?»', '"@vera which edge cases do you see in bulk product upload?"')}</li>
                </ul>
                <p style={{ margin: '0.45rem 0 0', opacity: 0.75 }}>
                  {t(
                    'También funciona por rol (@po, @architect, @qa…). Sin mención, responde el asistente de planeación general. Los agentes acá ACONSEJAN; actúan cuando las HUs llegan al tablero.',
                    'Role mentions work too (@po, @architect, @qa…). Without a mention, the general planning assistant replies. Agents ADVISE here; they act once stories reach the board.',
                  )}
                </p>
              </div>
            </details>
            <div className={styles.presence} style={{ fontSize: '0.75rem', color: 'var(--color-fg-muted)', padding: '0 0.25rem 0.4rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ color: connected ? 'var(--color-success, #3fb950)' : 'var(--color-fg-muted)' }}>
                {connected ? t('● Conectado', '● Connected') : t('○ Conectando…', '○ Connecting…')}
              </span>
              <span>· {t('En línea', 'Online')}: {onlineNames.join(', ')}</span>
            </div>
            <div className={styles.messages} ref={msgRef}>
              {plan.messages.map((m, i) => {
                const bubble =
                  m.role === 'user' && m.authorId
                    ? (() => {
                        const bg = effectiveColor(m.authorId, chatColors, members);
                        return { background: bg, color: contrastText(bg) };
                      })()
                    : undefined;
                return (
                <div
                  key={i}
                  className={`${styles.msg} ${m.role === 'assistant' ? styles.assistant : styles.user}`}
                  style={bubble}
                >
                  {m.role === 'user' && m.authorName && (
                    <span style={{ display: 'block', fontSize: '0.7rem', opacity: 0.75, marginBottom: '0.15rem' }}>
                      {m.authorName}
                    </span>
                  )}
                  {m.role === 'assistant' && m.agentName && (
                    <span
                      data-testid="agent-reply-name"
                      style={{ display: 'block', fontSize: '0.7rem', opacity: 0.8, marginBottom: '0.15rem', fontWeight: 600 }}
                    >
                      🤖 {m.agentName}
                    </span>
                  )}
                  {m.role === 'assistant' ? <Markdown compact>{m.content}</Markdown> : m.content}
                </div>
                );
              })}
              {sending && <div className={`${styles.msg} ${styles.assistant}`}>…</div>}
            </div>
            <div
              aria-live="polite"
              style={{ minHeight: '1.1rem', fontSize: '0.75rem', color: 'var(--color-fg-muted)', padding: '0 0.25rem' }}
            >
              {typingName ? t(`${typingName} está escribiendo…`, `${typingName} is typing…`) : ''}
            </div>
            {canWrite && !published && (
              <div className={styles.composer}>
                <textarea
                  className={styles.input}
                  rows={2}
                  value={input}
                  placeholder={t('Escribe tu respuesta…', 'Type your answer…')}
                  onChange={(e) => {
                    setInput(e.target.value);
                    pingTyping();
                  }}
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
                <Button variant="primary" onClick={generate} disabled={sending || generating}>
                  {generating ? t('Generando…', 'Generating…') : t('Generar plan', 'Generate plan')}
                </Button>
              </div>
            )}
          </div>
          <div className={styles.sideCol}>
            <PlanContext
              slug={slug}
              canWrite={canWrite}
              contextGraph={plan.contextGraph}
              contextFiles={contextFiles}
              onChange={setPlan}
            />
            <ChatColors
              slug={slug}
              members={members}
              colors={chatColors}
              onColorsChange={setChatColors}
            />
          </div>
        </div>
        {/* Link repos BEFORE a plan exists so an existing project can be analyzed
            (brownfield). Once a plan is generated, the repos section also appears
            in the preview pane below. */}
        {!generated && !generating && <PlanRepos slug={slug} canWrite={canWrite} />}
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
            <Link className={styles.skip} href={`/projects/${slug}/board`}>
              {t('Saltar al tablero', 'Skip to board')}
            </Link>
            {canWrite && (
              <button type="button" className={styles.linkBtn} onClick={clearChat} disabled={sending || generating}>
                {t('Reiniciar conversación', 'Restart conversation')}
              </button>
            )}
            {error && <span className={styles.error}>{error}</span>}
          </div>
        )}
      </div>

      {/* ---- Preview ---- */}
      {showPreview && (
        <div className={styles.preview}>
          {generating && (
            <div className={styles.generating}>
              <PlanProgress
                progress={progress}
                heartbeatAt={heartbeatAt}
                onRetry={generate}
                retrying={sending}
              />
            </div>
          )}
          {generated && !generating && (
            <>
              {generated.improvedIdea && (
                <div className={styles.refinedIdea}>
                  <h3 className={styles.refinedIdeaTitle}>{t('Idea afinada', 'Refined idea')}</h3>
                  <p className={styles.idea}>{generated.improvedIdea}</p>
                </div>
              )}
              <p className={styles.estimateNote}>
                {t(
                  'Estimaciones por seniority (Jr · SSr · Sr) asumiendo desarrollo asistido por IA (Qwen vía MCP + el plan de Opus).',
                  'Per-seniority estimates (Jr · SSr · Sr) assuming AI-assisted development (Qwen via MCP + the Opus plan).',
                )}
                {canEdit && (
                  <>
                    {' '}
                    <button type="button" className={styles.linkBtn} onClick={reestimate} disabled={reestimating}>
                      {reestimating
                        ? t('Recalculando…', 'Recomputing…')
                        : t('Recalcular estimaciones (IA)', 'Recompute estimates (AI)')}
                    </button>
                  </>
                )}
              </p>
              {generated.sprints.map((s, si) => {
                const open = openSprints.has(si);
                return (
                  <div key={si} className={styles.sprint}>
                    <PlanSprintHead
                      slug={slug}
                      sprintIndex={si}
                      name={s.name}
                      goal={s.goal}
                      canEdit={canEdit}
                      open={open}
                      taskCount={s.tasks.length}
                      onToggle={() =>
                        setOpenSprints((prev) => {
                          const next = new Set(prev);
                          if (next.has(si)) next.delete(si);
                          else next.add(si);
                          return next;
                        })
                      }
                      onChange={setPlan}
                      onError={setError}
                    />
                    {open && (
                      <div className={styles.taskGrid}>
                        {s.tasks.map((tk, ti) => (
                          <PlanTaskCard
                            key={ti}
                            slug={slug}
                            sprintIndex={si}
                            taskIndex={ti}
                            task={tk}
                            canEdit={canEdit}
                            canGenImpl={canGenImpl}
                            repoNames={generated.suggestedRepos?.map((r) => r.name) ?? []}
                            onChange={setPlan}
                            onError={(m) => setError(m || null)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              <PlanRepos slug={slug} canWrite={canWrite} />
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
