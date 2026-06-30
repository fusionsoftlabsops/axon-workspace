'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { MemberRole, Seniority } from '@prisma/client';
import {
  inviteMemberAction,
  removeMemberAction,
  updateMemberRoleAction,
  setMemberSeniorityAction,
  resendInvitationAction,
  transferOwnershipAction,
} from '@/lib/actions/projects';
import { useI18n } from '@/lib/i18n/i18n';

interface MemberView {
  id: string;
  userId: string;
  role: MemberRole;
  seniority: Seniority | null;
  name: string;
  email: string;
  joinedAt: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: MemberRole | null;
  seniority: Seniority | null;
  expiresAt: string;
}

const ROLES: MemberRole[] = ['ADMIN', 'MEMBER', 'VIEWER'];
const SENIORITIES: { value: Seniority; label: string }[] = [
  { value: 'JUNIOR', label: 'Junior' },
  { value: 'SEMI_SENIOR', label: 'Semi-senior' },
  { value: 'SENIOR', label: 'Senior' },
];

export function MembersPanel({
  projectSlug,
  currentUserId,
  ownerId,
  members,
  pendingInvites = [],
}: {
  projectSlug: string;
  currentUserId: string;
  ownerId: string;
  members: MemberView[];
  pendingInvites?: PendingInvite[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<{ link: string; email: string; emailSent: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('MEMBER');
  const [seniority, setSeniority] = useState<Seniority | ''>('');
  const [transferTo, setTransferTo] = useState('');

  const isOwnerMe = currentUserId === ownerId;

  function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setInviteLink(null);
    setCopied(false);
    startTransition(async () => {
      const r = await inviteMemberAction(projectSlug, {
        email,
        role,
        seniority: seniority || undefined,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const invitedEmail = email;
      setEmail('');
      setSeniority('');
      if (r.data?.pending && r.data.token) {
        setInviteLink({
          link: `${window.location.origin}/signup?token=${r.data.token}`,
          email: r.data.email ?? invitedEmail,
          emailSent: !!r.data.emailSent,
        });
      } else if (r.data && !r.data.pending) {
        // Existing account — added directly.
        setNotice(
          r.data.emailSent
            ? t('Agregado y notificado por email.', 'Added and notified by email.')
            : t('Agregado al proyecto.', 'Added to the project.'),
        );
      }
      router.refresh();
    });
  }

  function resend(invitationId: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await resendInvitationAction(projectSlug, invitationId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setNotice(
        r.data?.emailSent
          ? t('Invitación reenviada por email.', 'Invitation resent by email.')
          : t('No se pudo enviar el email; copia el enlace nuevo.', 'Could not send email; copy the new link.'),
      );
      if (r.data && !r.data.emailSent) {
        setInviteLink({
          link: `${window.location.origin}/signup?token=${r.data.token}`,
          email: r.data.email,
          emailSent: false,
        });
      }
      router.refresh();
    });
  }

  function transfer() {
    if (!transferTo) return;
    const target = members.find((m) => m.userId === transferTo);
    if (
      !confirm(
        t(
          `¿Transferir la propiedad del proyecto a ${target?.name ?? ''}? Pasarás a ser ADMIN y no podrás revertirlo tú mismo.`,
          `Transfer project ownership to ${target?.name ?? ''}? You will become ADMIN and cannot undo this yourself.`,
        ),
      )
    )
      return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await transferOwnershipAction(projectSlug, transferTo);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setTransferTo('');
      setNotice(t('Propiedad transferida.', 'Ownership transferred.'));
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

  function changeSeniority(userId: string, value: string) {
    startTransition(async () => {
      const r = await setMemberSeniorityAction(projectSlug, userId, value || null);
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
        <select
          value={seniority}
          onChange={(e) => setSeniority(e.target.value as Seniority | '')}
          title={t('Seniority (opcional)', 'Seniority (optional)')}
          style={{
            padding: '0.5rem',
            border: '1px solid var(--color-border)',
            borderRadius: '4px',
            background: 'var(--color-bg)',
            color: 'var(--color-fg)',
          }}
        >
          <option value="">{t('Seniority (opcional)', 'Seniority (optional)')}</option>
          {SENIORITIES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
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

      {notice && (
        <p
          style={{
            color: 'var(--color-accent)',
            padding: '0.5rem',
            background: 'rgba(99,102,241,0.08)',
            borderRadius: '4px',
          }}
        >
          {notice}
        </p>
      )}

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

      {pendingInvites.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.5rem' }}>
            {t('Invitaciones pendientes', 'Pending invitations')}
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {pendingInvites.map((inv) => (
                <tr key={inv.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.5rem' }}>{inv.email}</td>
                  <td style={{ padding: '0.5rem', color: 'var(--color-fg-muted)' }}>
                    {inv.role ?? '—'}
                    {inv.seniority ? ` · ${inv.seniority}` : ''}
                  </td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => resend(inv.id)}
                      disabled={pending}
                      style={{
                        padding: '0.3rem 0.75rem',
                        border: '1px solid var(--color-border)',
                        borderRadius: '4px',
                        background: 'transparent',
                        color: 'var(--color-fg)',
                      }}
                    >
                      {t('Reenviar', 'Resend')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
            <th style={{ padding: '0.65rem 0.5rem' }}>{t('Nombre', 'Name')}</th>
            <th style={{ padding: '0.65rem 0.5rem' }}>{t('Email', 'Email')}</th>
            <th style={{ padding: '0.65rem 0.5rem' }}>{t('Rol', 'Role')}</th>
            <th style={{ padding: '0.65rem 0.5rem' }}>{t('Seniority', 'Seniority')}</th>
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
                <td style={{ padding: '0.65rem 0.5rem' }}>
                  <select
                    value={m.seniority ?? ''}
                    disabled={pending}
                    onChange={(e) => changeSeniority(m.userId, e.target.value)}
                    style={{
                      padding: '0.3rem',
                      border: '1px solid var(--color-border)',
                      borderRadius: '4px',
                      background: 'var(--color-bg)',
                      color: 'var(--color-fg)',
                    }}
                  >
                    <option value="">{t('—', '—')}</option>
                    {SENIORITIES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
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

      {isOwnerMe && members.some((m) => m.userId !== ownerId) && (
        <div
          style={{
            marginTop: '2rem',
            padding: '1rem',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
          }}
        >
          <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.5rem' }}>
            {t('Transferir propiedad', 'Transfer ownership')}
          </h3>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--color-fg-muted)' }}>
            {t(
              'El nuevo dueño tendrá control total del proyecto. Tú pasarás a ADMIN.',
              'The new owner will have full control of the project. You will become ADMIN.',
            )}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <select
              value={transferTo}
              onChange={(e) => setTransferTo(e.target.value)}
              disabled={pending}
              style={{
                flex: 1,
                padding: '0.5rem',
                border: '1px solid var(--color-border)',
                borderRadius: '4px',
                background: 'var(--color-bg)',
                color: 'var(--color-fg)',
              }}
            >
              <option value="">{t('Elegí un miembro…', 'Choose a member…')}</option>
              {members
                .filter((m) => m.userId !== ownerId)
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name} ({m.email})
                  </option>
                ))}
            </select>
            <button
              type="button"
              onClick={transfer}
              disabled={pending || !transferTo}
              style={{
                padding: '0.5rem 1rem',
                border: '1px solid var(--color-danger)',
                borderRadius: '4px',
                background: 'transparent',
                color: 'var(--color-danger)',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              {t('Transferir', 'Transfer')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
