'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge, Button } from '@/components/ui';
import { useI18n } from '@/lib/i18n/i18n';
import { postTeamChatAction } from '@/lib/actions/team-chat';
import type { TeamMessageView } from '@/lib/agents/team-chat';
import styles from './team.module.scss';

const KIND_TONE: Record<string, 'ok' | 'accent' | 'neutral'> = {
  HANDOFF: 'accent',
  STATUS: 'neutral',
  CHAT: 'ok',
};

export function TeamChatClient({
  slug,
  canWrite,
  initialMessages,
}: {
  slug: string;
  canWrite: boolean;
  initialMessages: TeamMessageView[];
}) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<TeamMessageView[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Stream SSE: los mensajes de agentes y otros humanos llegan en vivo.
  useEffect(() => {
    const es = new EventSource(`/api/v1/projects/${slug}/team-chat/stream`);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as { type?: string; message?: TeamMessageView };
        if (event.type === 'team.message' && event.message) {
          const msg = event.message;
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        }
      } catch {
        /* frame no-JSON */
      }
    };
    return () => es.close();
  }, [slug]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    const res = await postTeamChatAction(slug, body);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDraft('');
    if (res.data) {
      const msg = res.data;
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    }
  }

  return (
    <div className={styles.chat}>
      <div className={styles.status}>
        <Badge tone={live ? 'ok' : 'neutral'} dot>
          {live ? t('En vivo', 'Live') : t('Reconectando…', 'Reconnecting…')}
        </Badge>
      </div>

      <div className={styles.thread} data-testid="team-thread">
        {messages.length === 0 && (
          <p className={styles.empty}>
            {t(
              'Todavía no hay conversación. Cuando el equipo trabaje una HU, sus turnos aparecerán aquí.',
              'No conversation yet. When the team works a story, their turns will show up here.',
            )}
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.agentRole ? styles.agentMsg : styles.humanMsg}>
            <div className={styles.msgHead}>
              <span className={styles.author}>
                {m.agentRole ? '🤖 ' : ''}
                {m.authorName}
              </span>
              {m.kind !== 'CHAT' && (
                <Badge tone={KIND_TONE[m.kind] ?? 'neutral'}>
                  {m.kind === 'HANDOFF' ? t('entrega', 'handoff') : t('estado', 'status')}
                </Badge>
              )}
              {m.storyNumber && <span className={styles.storyRef}>HU #{m.storyNumber}</span>}
              <span className={styles.time}>{new Date(m.createdAt).toLocaleTimeString()}</span>
            </div>
            <div className={styles.body}>{m.body}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {canWrite && (
        <div className={styles.composer}>
          <textarea
            className={styles.input}
            placeholder={t('Escribile al equipo…', 'Write to the team…')}
            value={draft}
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <Button variant="primary" size="sm" disabled={busy || !draft.trim()} onClick={() => void send()}>
            {busy ? t('Enviando…', 'Sending…') : t('Enviar', 'Send')}
          </Button>
        </div>
      )}
    </div>
  );
}
