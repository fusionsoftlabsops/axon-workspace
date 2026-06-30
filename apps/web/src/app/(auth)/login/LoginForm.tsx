'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { loginAction } from '@/lib/actions/auth';
import { PasswordInput } from '../signup/PasswordInput';
import styles from '../signup/SignupForm.module.scss';
import { useI18n } from '@/lib/i18n/i18n';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/projects';
  const { t } = useI18n();

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await loginAction(email, password, totp || undefined);
      if (res.ok) {
        router.push(callbackUrl);
        router.refresh();
        return;
      }
      if (res.error === 'TOTP_REQUIRED') {
        setNeedsTotp(true);
        setError(t('Ingresa el código de tu app de autenticación', 'Enter the code from your authenticator app'));
        return;
      }
      setError(t('Credenciales inválidas', 'Invalid credentials'));
    });
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label>
        <span>Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={needsTotp}
        />
      </label>

      <label>
        <span>{t('Contraseña', 'Password')}</span>
        <PasswordInput
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={needsTotp}
        />
      </label>

      {needsTotp && (
        <label>
          <span>{t('Código de 2FA', '2FA code')}</span>
          <input
            type="text"
            required
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoComplete="one-time-code"
            value={totp}
            onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
            autoFocus
          />
          <small>{t('6 dígitos de tu app de autenticación (Google Authenticator, 1Password…)', '6 digits from your authenticator app (Google Authenticator, 1Password…)')}</small>
        </label>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <button type="submit" disabled={pending} className={styles.submit}>
        {pending
          ? t('Verificando…', 'Verifying…')
          : needsTotp
            ? t('Verificar 2FA', 'Verify 2FA')
            : t('Iniciar sesión', 'Sign in')}
      </button>

      {!needsTotp && (
        <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', textAlign: 'center' }}>
          <Link href="/forgot-password" style={{ color: 'var(--color-fg-muted)' }}>
            {t('¿Olvidaste tu contraseña?', 'Forgot your password?')}
          </Link>
        </p>
      )}
    </form>
  );
}
