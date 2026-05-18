'use client';

import { useState, useTransition } from 'react';
import { useVaultUnlock } from '@/components/vault/UnlockContext';
import styles from './vault.module.scss';

export function UnlockPrompt() {
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
        Passphrase del vault
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
        {pending ? 'Desbloqueando…' : 'Desbloquear'}
      </button>
      <small>
        La passphrase nunca sale del navegador. Si la pierdes, no puedes recuperar el vault.
      </small>
    </form>
  );
}
