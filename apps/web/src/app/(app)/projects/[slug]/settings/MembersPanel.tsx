'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { MemberRole } from '@prisma/client';
import {
  inviteMemberAction,
  removeMemberAction,
  updateMemberRoleAction,
} from '@/lib/actions/projects';
import { useI18n } from '@/lib/i18n/i18n';

interface MemberView {
  id: string;
  userId: string;
  role: MemberRole;
  name: string;
  email: string;
  joinedAt: string;
}

const ROLES: MemberRole[] = ['ADMIN', 'MEMBER', 'VIEWER'];

export function MembersPanel({
  projectSlug,
  currentUserId,
  ownerId,
  members,
}: {
  projectSlug: string;
  currentUserId: string;
  ownerId: string;
  members: MemberView[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<{ link: string; email: string; emailSent: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('MEMBER');

  function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInviteLink(null);
    setCopied(false);
    startTransition(async () => {
      const r = await inviteMemberAction(projectSlug, { email, role });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const invitedEmail = email;
      setEmail('');
      if (r.data?.pending && r.data.token) {
        setInviteLink({
          link: `${window.location.origin}/signup?token=${r.data.token}`,
          email: r.data.email ?? invitedEmail,
          emailSent: !!r.data.emailSent,
        });
      }
      router.refresh();
    });
  }

  function changeRole(userId: string, newRole: MemberRole) {
    startTransition(async () => {
      const r = await updateMemberRoleAction(projectSlug, userId, newRole);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function remove(userId: string, name: string) {
    if (!confirm(t(`¿Expulsar a ${name} del proyecto?`, `Remove ${name} from the project?`))) return;
    startTransition(async () => {
      const r = await removeMemberAction(projectSlug, userId);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div>
      <form
        onSubmit={invite}
        style={{
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'center',
          padding: '1rem',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          marginBottom: '1.5rem',
        }}
      >
        <input
          type="email"
          placeholder={t('email@dominio.com', 'email@domain.com')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{
            flex: 1,
            padding: '0.5rem',
            border: '1px solid var(--color-border)',
            borderRadius: '4px',
            background: 'var(--color-bg)',
            color: 'var(--color-fg)',
          }}
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as MemberRole)}
          style={{
            padding: '0.5rem',
            border: '1px solid var(--color-border)',
            borderRadius: '4px',
            background: 'var(--color-bg)',
            color: 'var(--color-fg)',
          }}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          style={{
            padding: '0.5rem 1rem',
            border: 'none',
            borderRadius: '4px',
            background: 'var(--color-accent)',
            color: 'var(--color-accent-fg)',
            fontWeight: 600,
          }}
        >
          {t('Invitar', 'Invite')}
        </button>
      </form>

      {error && (
        <p
          style={{
            color: 'var(--color-danger)',
            padding: '0.5rem',
            background: 'rgba(239,68,68,0.08)',
            borderRadius: '4px',
          }}
        >
          {error}
        </p>
      )}

      {inviteLink && (
        <div
          style={{
            padding: '0.75rem 1rem',
            background: 'rgba(99,102,241,0.08)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            marginBottom: '1.5rem',
          }}
        >
          <p style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>
            {t(
              `Invitación creada para ${inviteLink.email}. Aún no tiene cuenta: al registrarse con este enlace se unirá al proyecto.`,
              `Invitation created for ${inviteLink.email}. They don't have an account yet — signing up with this link joins them to the project.`,
            )}
            {inviteLink.emailSent
              ? ' ' + t('Le enviamos el enlace por email.', 'We emailed them the link.')
              : ' ' + t('Comparte este enlace:', 'Share this link:')}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              readOnly
              value={inviteLink.link}
              onFocus={(e) => e.currentTarget.select()}
              style={{
                flex: 1,
                padding: '0.45rem 0.6rem',
                border: '1px solid var(--color-border)',
                borderRadius: '4px',
                background: 'var(--color-bg)',
                color: 'var(--color-fg)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
              }}
            />
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(inviteLink.link).then(() => setCopied(true));
              }}
              style={{
                padding: '0.45rem 0.8rem',
                border: '1px solid var(--color-border)',
                borderRadius: '4px',
                background: 'transparent',
                color: 'var(--color-fg)',
                whiteSpace: 'nowrap',
              }}
            >
              {copied ? t('¡Copiado!', 'Copied!') : t('Copiar', 'Copy')}
            </button>
          </div>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
            <th style={{ padding: '0.65rem 0.5rem' }}>{t('Nombre', 'Name')}</th>
            <th style={{ padding: '0.65rem 0.5rem' }}>{t('Email', 'Email')}</th>
            <th style={{ padding: '0.65rem 0.5rem' }}>{t('Rol', 'Role')}</th>
            <th style={{ padding: '0.65rem 0.5rem' }}></th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const isOwner = m.userId === ownerId;
            const isSelf = m.userId === currentUserId;
            return (
              <tr key={m.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: '0.65rem 0.5rem' }}>{m.name}</td>
                <td style={{ padding: '0.65rem 0.5rem', color: 'var(--color-fg-muted)' }}>
                  {m.email}
                </td>
                <td style={{ padding: '0.65rem 0.5rem' }}>
                  {isOwner ? (
                    <span
                      style={{
                        padding: '0.2rem 0.5rem',
                        background: 'rgba(99,102,241,0.12)',
                        color: 'var(--color-accent)',
                        borderRadius: '999px',
                        fontSize: '0.75rem',
                      }}
                    >
                      OWNER
                    </span>
                  ) : (
                    <select
                      value={m.role}
                      disabled={pending}
                      onChange={(e) => changeRole(m.userId, e.target.value as MemberRole)}
                      style={{
                        padding: '0.3rem',
                        border: '1px solid var(--color-border)',
                        borderRadius: '4px',
                        background: 'var(--color-bg)',
                        color: 'var(--color-fg)',
                      }}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>
                  {!isOwner && !isSelf && (
                    <button
                      onClick={() => remove(m.userId, m.name)}
                      disabled={pending}
                      style={{
                        padding: '0.3rem 0.75rem',
                        border: '1px solid var(--color-border)',
                        borderRadius: '4px',
                        background: 'transparent',
                        color: 'var(--color-danger)',
                      }}
                    >
                      {t('Expulsar', 'Remove')}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
