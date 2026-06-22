'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
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
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
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
      setLink({ email: r.data.email, url });
      setEmail('');
      router.refresh();
    });
  }

  function revoke(id: string) {
    if (!confirm('Revocar esta invitación pendiente?')) return;
    startTransition(async () => {
      const r = await revokeInvitationAction(id);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function statusOf(i: InvitationView): string {
    if (i.acceptedAt) return 'Aceptada';
    if (i.expired) return 'Expirada';
    return 'Pendiente';
  }

  return (
    <>
      <form style={box} onSubmit={invite}>
        <h3>Invitar a alguien</h3>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          Email
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
          {pending ? 'Generando…' : 'Generar invitación'}
        </button>

        {link && (
          <div style={{ marginTop: '0.5rem' }}>
            <p>
              Enlace para <strong>{link.email}</strong> (se muestra una sola vez):
            </p>
            <div style={linkBox}>{link.url}</div>
            <button type="button" onClick={() => navigator.clipboard.writeText(link.url)}>
              Copiar enlace
            </button>
          </div>
        )}
      </form>

      <div style={box}>
        <h3>Invitaciones</h3>
        {initial.length === 0 && <p>Aún no generaste invitaciones.</p>}
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
                    Revocar
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
