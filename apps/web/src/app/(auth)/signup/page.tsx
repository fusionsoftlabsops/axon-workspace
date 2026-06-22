import Link from 'next/link';
import { SignupForm } from './SignupForm';
import { getInvitationByToken } from '@/lib/actions/invitations';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const invite = token ? await getInvitationByToken(token) : null;

  if (!token || !invite || !invite.ok) {
    return (
      <>
        <h1>Registro por invitación</h1>
        <p>
          El acceso a esta plataforma es <strong>solo por invitación</strong>. Pedí a un
          administrador que te envíe un enlace de invitación.
        </p>
        {token && invite && !invite.ok && (
          <p style={{ color: 'var(--color-danger)', fontSize: '0.9rem' }}>{invite.error}</p>
        )}
        <p style={{ marginTop: '1.5rem', fontSize: '0.9rem' }}>
          ¿Ya tienes cuenta? <Link href="/login">Inicia sesión</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Crear cuenta</h1>
      <p>
        Invitación para <strong>{invite.email}</strong>. Tu passphrase nunca sale del navegador;
        si la pierdes, recupéras el vault con tu código de recuperación.
      </p>
      <SignupForm token={token} invitedEmail={invite.email} />
      <p style={{ marginTop: '1.5rem', fontSize: '0.9rem' }}>
        ¿Ya tienes cuenta? <Link href="/login">Inicia sesión</Link>
      </p>
    </>
  );
}
