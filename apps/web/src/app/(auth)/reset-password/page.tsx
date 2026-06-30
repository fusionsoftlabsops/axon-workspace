import Link from 'next/link';
import { getServerT } from '@/lib/i18n/server';
import { ResetPasswordForm } from './ResetPasswordForm';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const t = await getServerT();
  const { token } = await searchParams;

  if (!token) {
    return (
      <>
        <h1>{t('Restablecer contraseña', 'Reset password')}</h1>
        <p style={{ color: 'var(--color-danger)' }}>
          {t('Falta el token del enlace.', 'The link token is missing.')}
        </p>
        <Link href="/forgot-password">{t('Solicitar un enlace nuevo', 'Request a new link')}</Link>
      </>
    );
  }

  return (
    <>
      <h1>{t('Nueva contraseña', 'New password')}</h1>
      <p style={{ marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--color-fg-muted)' }}>
        {t(
          'Elegí una contraseña de login nueva (mínimo 12 caracteres). Tu vault de credenciales no cambia.',
          'Choose a new login password (at least 12 characters). Your credentials vault is unchanged.',
        )}
      </p>
      <ResetPasswordForm token={token} />
    </>
  );
}
