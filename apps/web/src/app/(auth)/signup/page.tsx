import Link from 'next/link';
import { SignupForm } from './SignupForm';
import { getInvitationByToken } from '@/lib/actions/invitations';
import { getServerT } from '@/lib/i18n/server';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const invite = token ? await getInvitationByToken(token) : null;
  const t = await getServerT();

  if (!token || !invite || !invite.ok) {
    return (
      <>
        <h1>{t('Registro por invitación', 'Invite-only signup')}</h1>
        <p>
          {t('El acceso a esta plataforma es', 'Access to this platform is')}{' '}
          <strong>{t('solo por invitación', 'invite-only')}</strong>.{' '}
          {t('Pedí a un administrador que te envíe un enlace de invitación.', 'Ask an administrator to send you an invitation link.')}
        </p>
        {token && invite && !invite.ok && (
          <p style={{ color: 'var(--color-danger)', fontSize: '0.9rem' }}>{invite.error}</p>
        )}
        <p style={{ marginTop: '1.5rem', fontSize: '0.9rem' }}>
          {t('¿Ya tienes cuenta?', 'Already have an account?')} <Link href="/login">{t('Inicia sesión', 'Sign in')}</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1>{t('Crear cuenta', 'Create account')}</h1>
      <p>
        {t('Invitación para', 'Invitation for')} <strong>{invite.email}</strong>.{' '}
        {t('Tu passphrase nunca sale del navegador; si la pierdes, recupéras el vault con tu código de recuperación.', 'Your passphrase never leaves the browser; if you lose it, you recover the vault with your recovery code.')}
      </p>
      <SignupForm token={token} invitedEmail={invite.email} />
      <p style={{ marginTop: '1.5rem', fontSize: '0.9rem' }}>
        {t('¿Ya tienes cuenta?', 'Already have an account?')} <Link href="/login">{t('Inicia sesión', 'Sign in')}</Link>
      </p>
    </>
  );
}
