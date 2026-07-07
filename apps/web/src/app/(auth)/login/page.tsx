import { Suspense } from 'react';
import { LoginForm } from './LoginForm';
import { getServerT } from '@/lib/i18n/server';
import { isOidcConfigured } from '@/lib/auth/oidc';

export default async function LoginPage() {
  const t = await getServerT();
  return (
    <>
      <h1>{t('Iniciar sesión', 'Sign in')}</h1>
      <Suspense fallback={null}>
        <LoginForm ssoEnabled={isOidcConfigured()} />
      </Suspense>
      <p style={{ marginTop: '1.5rem', fontSize: '0.9rem', color: 'var(--color-fg-muted)' }}>
        {t(
          'El acceso se gestiona con tu cuenta corporativa (SSO). El alta y la recuperación las administra el proveedor de identidad.',
          'Access is managed with your corporate account (SSO). Onboarding and recovery are handled by the identity provider.',
        )}
      </p>
    </>
  );
}
