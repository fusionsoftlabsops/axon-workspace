import { getServerT } from '@/lib/i18n/server';
import { ForgotPasswordForm } from './ForgotPasswordForm';

export default async function ForgotPasswordPage() {
  const t = await getServerT();
  return (
    <>
      <h1>{t('Restablecer contraseña', 'Reset password')}</h1>
      <p style={{ marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--color-fg-muted)' }}>
        {t(
          'Te enviaremos un enlace para restablecer tu contraseña de login. Esto no afecta tu vault de credenciales (se recupera aparte con tu código de recuperación).',
          'We will email you a link to reset your login password. This does not affect your credentials vault (recovered separately with your recovery code).',
        )}
      </p>
      <ForgotPasswordForm />
    </>
  );
}
