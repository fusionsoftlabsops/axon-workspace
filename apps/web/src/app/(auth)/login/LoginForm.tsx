'use client';

import { ssoLoginAction } from '@/lib/actions/auth';
import styles from './LoginForm.module.scss';
import { useI18n } from '@/lib/i18n/i18n';

/**
 * Login SOLO por SSO (OIDC / Authentik). No hay login local por contraseña:
 * el alta y la autenticación (incl. 2FA) las gestiona el IdP. Si el SSO no está
 * configurado (`ssoEnabled=false`) no se muestra ningún botón de acceso.
 */
export function LoginForm({ ssoEnabled = false }: { ssoEnabled?: boolean }) {
  const { t } = useI18n();

  if (!ssoEnabled) {
    return (
      <p className={styles.sso}>
        {t(
          'El acceso por SSO no está configurado. Contactá a un administrador.',
          'SSO access is not configured. Contact an administrator.',
        )}
      </p>
    );
  }

  return (
    <form action={ssoLoginAction} className={styles.sso}>
      <button type="submit" className={styles.submit}>
        {t('Iniciar sesión con SSO', 'Sign in with SSO')}
      </button>
    </form>
  );
}
