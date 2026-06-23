'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { signupAction } from '@/lib/actions/auth';
import { generateProtectedKeypairWithRecovery, toBase64 } from '@/lib/crypto';
import { PasswordInput } from './PasswordInput';
import styles from './SignupForm.module.scss';
import { useI18n } from '@/lib/i18n/i18n';

interface FormState {
  email: string;
  name: string;
  password: string;
  passphrase: string;
  passphraseConfirm: string;
}

export function SignupForm({ token, invitedEmail }: { token: string; invitedEmail: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    email: invitedEmail,
    name: '',
    password: '',
    passphrase: '',
    passphraseConfirm: '',
  });

  const update =
    (k: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((s) => ({ ...s, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (form.passphrase.length < 12) {
      setError(t('La passphrase debe tener al menos 12 caracteres', 'The passphrase must be at least 12 characters long'));
      return;
    }
    if (form.passphrase !== form.passphraseConfirm) {
      setError(t('Las passphrases no coinciden', 'The passphrases do not match'));
      return;
    }
    if (form.password.length < 12) {
      setError(t('La contraseña de login debe tener al menos 12 caracteres', 'The login password must be at least 12 characters long'));
      return;
    }
    if (form.password === form.passphrase) {
      setError(t('La contraseña de login y la passphrase del vault deben ser diferentes', 'The login password and the vault passphrase must be different'));
      return;
    }

    startTransition(async () => {
      try {
        setProgress(t('Generando claves criptográficas (~3-5s)…', 'Generating cryptographic keys (~3-5s)…'));
        // Yield to the browser so the progress message renders before we
        // start the CPU-heavy argon2id derivation.
        await new Promise((r) => setTimeout(r, 50));
        const protected_ = generateProtectedKeypairWithRecovery(form.passphrase);

        setProgress(t('Registrando cuenta…', 'Registering account…'));
        const result = await signupAction({
          token,
          email: form.email,
          name: form.name,
          password: form.password,
          publicKey: toBase64(protected_.publicKey),
          encryptedPrivateKey: toBase64(protected_.encryptedPrivateKey),
          encryptedPrivKeyNonce: toBase64(protected_.encryptedPrivKeyNonce),
          kdfSalt: toBase64(protected_.kdfSalt),
          recoveryHash: protected_.recoveryProof,
          encryptedPrivKeyRecovery: toBase64(protected_.encryptedPrivKeyRecovery),
          recoveryPrivKeyNonce: toBase64(protected_.recoveryPrivKeyNonce),
          recoveryKdfSalt: toBase64(protected_.recoveryKdfSalt),
        });

        if (!result.ok) {
          setError(result.error);
          setProgress(null);
          return;
        }

        // Mostrar el código de recuperación UNA sola vez antes de continuar.
        setProgress(null);
        setRecoveryCode(protected_.recoveryCode);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('Error inesperado', 'Unexpected error'));
        setProgress(null);
      }
    });
  }

  if (recoveryCode) {
    return (
      <div className={styles.form}>
        <h3>{t('Guarda tu código de recuperación', 'Save your recovery code')}</h3>
        <p>
          {t('Es la', 'It is the')} <strong>{t('única', 'only')}</strong>{' '}
          {t(
            'forma de recuperar tu vault si olvidas la passphrase. Guárdalo en un lugar seguro (gestor de contraseñas). No se volverá a mostrar y el servidor no lo conoce.',
            'way to recover your vault if you forget the passphrase. Store it somewhere safe (a password manager). It will not be shown again and the server does not know it.',
          )}
        </p>
        <pre className={styles.recoveryCode}>{recoveryCode}</pre>
        <button
          type="button"
          className={styles.submit}
          onClick={() => navigator.clipboard.writeText(recoveryCode)}
        >
          {t('Copiar código', 'Copy code')}
        </button>
        <button
          type="button"
          className={styles.submit}
          onClick={() => router.push('/login?signed_up=1')}
        >
          {t('Ya lo guardé — continuar al login', 'I saved it — continue to login')}
        </button>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <label>
        <span>{t('Email (de la invitación)', 'Email (from the invitation)')}</span>
        <input type="email" value={form.email} readOnly disabled autoComplete="email" />
      </label>

      <label>
        <span>{t('Nombre', 'Name')}</span>
        <input type="text" required value={form.name} onChange={update('name')} />
      </label>

      <label>
        <span>{t('Contraseña de login', 'Login password')}</span>
        <PasswordInput
          required
          autoComplete="new-password"
          minLength={12}
          value={form.password}
          onChange={update('password')}
        />
        <small>{t('Mínimo 12 caracteres. Se usa para autenticarte con el servidor.', 'At least 12 characters. Used to authenticate you with the server.')}</small>
      </label>

      <label>
        <span>{t('Passphrase del vault', 'Vault passphrase')}</span>
        <PasswordInput
          required
          autoComplete="new-password"
          minLength={12}
          value={form.passphrase}
          onChange={update('passphrase')}
        />
        <small>
          {t('Mínimo 12 caracteres. Encripta tus credenciales E2E.', 'At least 12 characters. Encrypts your credentials end-to-end.')}{' '}
          <strong>{t('Si la pierdes, pierdes el vault.', 'If you lose it, you lose the vault.')}</strong>
        </small>
      </label>

      <label>
        <span>{t('Confirma la passphrase', 'Confirm the passphrase')}</span>
        <PasswordInput
          required
          autoComplete="new-password"
          value={form.passphraseConfirm}
          onChange={update('passphraseConfirm')}
        />
      </label>

      {error && <p className={styles.error}>{error}</p>}
      {progress && !error && <p className={styles.progress}>{progress}</p>}

      <button type="submit" disabled={pending} className={styles.submit}>
        {pending ? t('Procesando…', 'Processing…') : t('Crear cuenta', 'Create account')}
      </button>
    </form>
  );
}
