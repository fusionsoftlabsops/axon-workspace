'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useI18n } from '@/lib/i18n/i18n';
import {
  createInvitationAction,
  revokeInvitationAction,
  type InvitationView,
} from '@/lib/actions/invitations';

const box: React.CSSProperties = {
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  padding: '1.25rem',
  marginTop: '1.5rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
};
const linkBox: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.85rem',
  padding: '0.75rem',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  userSelect: 'all',
  wordBreak: 'break-all',
};

export function InvitationsPanel({ initial }: { initial: InvitationView[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ email: string; url: string; emailSent: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLink(null);
    startTransition(async () => {
      const r = await createInvitationAction({ email });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const url = `${window.location.origin}/signup?token=${r.data.token}`;
      setLink({ email: r.data.email, url, emailSent: r.data.emailSent });
      setEmail('');
      router.refresh();
    });
  }

  function revoke(id: string) {
    if (!confirm(t('Revocar esta invitación pendiente?', 'Revoke this pending invitation?'))) return;
    startTransition(async () => {
      const r = await revokeInvitationAction(id);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function statusOf(i: InvitationView): string {
    if (i.acceptedAt) return t('Aceptada', 'Accepted');
    if (i.expired) return t('Expirada', 'Expired');
    return t('Pendiente', 'Pending');
  }

  return (
    <>
      <form style={box} onSubmit={invite}>
        <h3>{t('Invitar a alguien', 'Invite someone')}</h3>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {t('Email', 'Email')}
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="persona@empresa.com"
          />
        </label>
        {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? t('Generando…', 'Generating…') : t('Generar invitación', 'Generate invitation')}
        </button>

        {link && (
          <div style={{ marginTop: '0.5rem' }}>
            <p>
              {link.emailSent ? (
                <>{t('✓ Invitación enviada por email a ', '✓ Invitation sent by email to ')}<strong>{link.email}</strong>. </>
              ) : (
                <>{t('No se pudo enviar el email (SMTP no configurado o falló). ', 'Could not send the email (SMTP not configured or failed). ')}</>
              )}
              {t('Enlace para ', 'Link for ')}<strong>{link.email}</strong>{t(' (se muestra una sola vez):', ' (shown only once):')}
            </p>
            <div style={linkBox}>{link.url}</div>
            <button type="button" onClick={() => navigator.clipboard.writeText(link.url)}>
              {t('Copiar enlace', 'Copy link')}
            </button>
          </div>
        )}
      </form>

      <div style={box}>
        <h3>{t('Invitaciones', 'Invitations')}</h3>
        {initial.length === 0 && <p>{t('Aún no generaste invitaciones.', 'You have not generated any invitations yet.')}</p>}
        {initial.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {initial.map((i) => (
              <li
                key={i.id}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}
              >
                <span>
                  {i.email} <small style={{ color: 'var(--color-fg-muted)' }}>· {statusOf(i)}</small>
                </span>
                {!i.acceptedAt && (
                  <button type="button" onClick={() => revoke(i.id)} disabled={pending}>
                    {t('Revocar', 'Revoke')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
