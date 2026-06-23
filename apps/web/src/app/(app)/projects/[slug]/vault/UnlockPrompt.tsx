'use client';

import { useState, useTransition } from 'react';
import { useI18n } from '@/lib/i18n/i18n';
import { useVaultUnlock } from '@/components/vault/UnlockContext';
import styles from './vault.module.scss';

export function UnlockPrompt() {
  const { t } = useI18n();
  const { unlock } = useVaultUnlock();
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await unlock(passphrase);
      if (!r.ok) {
        setError(r.error);
        setPassphrase('');
      }
    });
  }

  return (
    <form className={styles.unlock} onSubmit={submit}>
      <label>
        {t('Passphrase del vault', 'Vault passphrase')}
        <input
          type="password"
          autoFocus
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          required
        />
      </label>
      {error && <p className={styles.error}>{error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? t('Desbloqueando…', 'Unlocking…') : t('Desbloquear', 'Unlock')}
      </button>
      <small>
        {t('La passphrase nunca sale del navegador. Si la olvidaste, usa tu código de recuperación en', 'The passphrase never leaves the browser. If you forgot it, use your recovery code in')}{' '}
        <a href="/settings/recovery">{t('Ajustes → Recuperación', 'Settings → Recovery')}</a>.
      </small>
    </form>
  );
}
