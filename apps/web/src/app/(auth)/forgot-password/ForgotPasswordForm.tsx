'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { requestPasswordResetAction } from '@/lib/actions/password-reset';
import styles from '../signup/SignupForm.module.scss';
import { useI18n } from '@/lib/i18n/i18n';

export function ForgotPasswordForm() {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      await requestPasswordResetAction({ email });
      // Always show the same confirmation (anti-enumeration).
      setDone(true);
    });
  }

  if (done) {
    return (
      <div className={styles.form}>
        <p style={{ color: 'var(--color-success)' }}>
          {t(
            'Si existe una cuenta con ese email, te enviamos un enlace para restablecer la contraseña. Revisá tu bandeja (y spam).',
            'If an account exists for that email, we sent a reset link. Check your inbox (and spam).',
          )}
        </p>
        <Link href="/login" className={styles.submit} style={{ textAlign: 'center' }}>
          {t('Volver al login', 'Back to login')}
        </Link>
      </div>
    );
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
        />
      </label>
      <button type="submit" disabled={pending} className={styles.submit}>
        {pending ? t('Enviando…', 'Sending…') : t('Enviar enlace', 'Send link')}
      </button>
      <Link href="/login" style={{ fontSize: '0.85rem', color: 'var(--color-fg-muted)', textAlign: 'center' }}>
        {t('Volver al login', 'Back to login')}
      </Link>
    </form>
  );
}
