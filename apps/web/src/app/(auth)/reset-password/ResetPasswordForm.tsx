'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { resetPasswordAction } from '@/lib/actions/password-reset';
import { PasswordInput } from '../signup/PasswordInput';
import styles from '../signup/SignupForm.module.scss';
import { useI18n } from '@/lib/i18n/i18n';

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError(t('La contraseña debe tener al menos 12 caracteres', 'The password must be at least 12 characters long'));
      return;
    }
    if (password !== confirm) {
      setError(t('Las contraseñas no coinciden', 'The passwords do not match'));
      return;
    }
    startTransition(async () => {
      const r = await resetPasswordAction({ token, password });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push('/login?reset=1');
    });
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label>
        <span>{t('Nueva contraseña', 'New password')}</span>
        <PasswordInput
          required
          autoComplete="new-password"
          minLength={12}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label>
        <span>{t('Confirmar contraseña', 'Confirm password')}</span>
        <PasswordInput
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      {error && <p className={styles.error}>{error}</p>}
      <button type="submit" disabled={pending} className={styles.submit}>
        {pending ? t('Guardando…', 'Saving…') : t('Cambiar contraseña', 'Change password')}
      </button>
    </form>
  );
}
