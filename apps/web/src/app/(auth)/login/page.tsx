import { Suspense } from 'react';
import { LoginForm } from './LoginForm';
import { getServerT } from '@/lib/i18n/server';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ signed_up?: string; callbackUrl?: string }>;
}) {
  const t = await getServerT();
  return (
    <>
      <h1>{t('Iniciar sesión', 'Sign in')}</h1>
      <AwaitedFlash searchParams={searchParams} />
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
      <p style={{ marginTop: '1.5rem', fontSize: '0.9rem', color: 'var(--color-fg-muted)' }}>
        {t(
          'El acceso es solo por invitación. Si recibiste un enlace de invitación, abrilo para crear tu cuenta.',
          'Access is invite-only. If you received an invitation link, open it to create your account.',
        )}
      </p>
    </>
  );
}

async function AwaitedFlash({
  searchParams,
}: {
  searchParams: Promise<{ signed_up?: string }>;
}) {
  const params = await searchParams;
  if (params.signed_up === '1') {
    const t = await getServerT();
    return (
      <p style={{ color: 'var(--color-success)', fontSize: '0.9rem' }}>
        {t('Cuenta creada. Inicia sesión.', 'Account created. Sign in.')}
      </p>
    );
  }
  return null;
}
