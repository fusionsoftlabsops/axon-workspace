'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { initVaultAction } from '@/lib/actions/vault';
import { generateProtectedKeypairWithRecovery, toBase64 } from '@/lib/crypto';
import { useI18n } from '@/lib/i18n/i18n';
import styles from './vault.module.scss';

/**
 * Flujo opt-in para que un usuario federado (SSO, sin passphrase) inicialice su
 * vault E2E la primera vez que necesita un secreto. Mismo modelo zero-knowledge
 * que el signup: el keypair y el sellado ocurren en el navegador; el servidor
 * nunca ve la passphrase.
 */
export function InitVaultForm() {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (passphrase.length < 12) {
      setError(t('La passphrase debe tener al menos 12 caracteres', 'The passphrase must be at least 12 characters long'));
      return;
    }
    if (passphrase !== confirm) {
      setError(t('Las passphrases no coinciden', 'The passphrases do not match'));
      return;
    }
    startTransition(async () => {
      try {
        setProgress(t('Generando claves criptográficas (~3-5s)…', 'Generating cryptographic keys (~3-5s)…'));
        await new Promise((r) => setTimeout(r, 50));
        const p = generateProtectedKeypairWithRecovery(passphrase);
        setProgress(t('Inicializando vault…', 'Initializing vault…'));
        const res = await initVaultAction({
          publicKey: toBase64(p.publicKey),
          encryptedPrivateKey: toBase64(p.encryptedPrivateKey),
          encryptedPrivKeyNonce: toBase64(p.encryptedPrivKeyNonce),
          kdfSalt: toBase64(p.kdfSalt),
          recoveryHash: p.recoveryProof,
          encryptedPrivKeyRecovery: toBase64(p.encryptedPrivKeyRecovery),
          recoveryPrivKeyNonce: toBase64(p.recoveryPrivKeyNonce),
          recoveryKdfSalt: toBase64(p.recoveryKdfSalt),
        });
        if (!res.ok) {
          setError(res.error);
          setProgress(null);
          return;
        }
        setProgress(null);
        setRecoveryCode(p.recoveryCode);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('Error inesperado', 'Unexpected error'));
        setProgress(null);
      }
    });
  }

  if (recoveryCode) {
    return (
      <div className={styles.unlock}>
        <h3>{t('Guarda tu código de recuperación', 'Save your recovery code')}</h3>
        <p>
          {t(
            'Es la única forma de recuperar tu vault si olvidas la passphrase. Guárdalo en un lugar seguro. No se volverá a mostrar y el servidor no lo conoce.',
            'It is the only way to recover your vault if you forget the passphrase. Store it somewhere safe. It will not be shown again and the server does not know it.',
          )}
        </p>
        <pre>{recoveryCode}</pre>
        <button type="button" onClick={() => navigator.clipboard.writeText(recoveryCode)}>
          {t('Copiar código', 'Copy code')}
        </button>
        <button type="button" onClick={() => router.refresh()}>
          {t('Ya lo guardé — continuar', 'I saved it — continue')}
        </button>
      </div>
    );
  }

  return (
    <form className={styles.unlock} onSubmit={submit}>
      <p>
        {t(
          'Tu cuenta es federada (SSO) y aún no tiene vault. Crea una passphrase para poder guardar y compartir secretos cifrados de extremo a extremo.',
          'Your account is federated (SSO) and has no vault yet. Create a passphrase to store and share end-to-end encrypted secrets.',
        )}
      </p>
      <label>
        {t('Passphrase del vault', 'Vault passphrase')}
        <input type="password" autoFocus minLength={12} required value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
      </label>
      <label>
        {t('Confirma la passphrase', 'Confirm the passphrase')}
        <input type="password" minLength={12} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      {error && <p className={styles.error}>{error}</p>}
      {progress && !error && <p>{progress}</p>}
      <button type="submit" disabled={pending}>
        {pending ? t('Procesando…', 'Processing…') : t('Inicializar vault', 'Initialize vault')}
      </button>
    </form>
  );
}
