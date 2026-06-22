'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { signupAction } from '@/lib/actions/auth';
import { generateProtectedKeypairWithRecovery, toBase64 } from '@/lib/crypto';
import styles from './SignupForm.module.scss';

interface FormState {
  email: string;
  name: string;
  password: string;
  passphrase: string;
  passphraseConfirm: string;
}

export function SignupForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    email: '',
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
      setError('La passphrase debe tener al menos 12 caracteres');
      return;
    }
    if (form.passphrase !== form.passphraseConfirm) {
      setError('Las passphrases no coinciden');
      return;
    }
    if (form.password.length < 12) {
      setError('La contraseña de login debe tener al menos 12 caracteres');
      return;
    }
    if (form.password === form.passphrase) {
      setError('La contraseña de login y la passphrase del vault deben ser diferentes');
      return;
    }

    startTransition(async () => {
      try {
        setProgress('Generando claves criptográficas (~3-5s)…');
        // Yield to the browser so the progress message renders before we
        // start the CPU-heavy argon2id derivation.
        await new Promise((r) => setTimeout(r, 50));
        const protected_ = generateProtectedKeypairWithRecovery(form.passphrase);

        setProgress('Registrando cuenta…');
        const result = await signupAction({
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
        setError(err instanceof Error ? err.message : 'Error inesperado');
        setProgress(null);
      }
    });
  }

  if (recoveryCode) {
    return (
      <div className={styles.form}>
        <h3>Guarda tu código de recuperación</h3>
        <p>
          Es la <strong>única</strong> forma de recuperar tu vault si olvidas la passphrase.
          Guárdalo en un lugar seguro (gestor de contraseñas). No se volverá a mostrar y el
          servidor no lo conoce.
        </p>
        <pre className={styles.recoveryCode}>{recoveryCode}</pre>
        <button
          type="button"
          className={styles.submit}
          onClick={() => navigator.clipboard.writeText(recoveryCode)}
        >
          Copiar código
        </button>
        <button
          type="button"
          className={styles.submit}
          onClick={() => router.push('/login?signed_up=1')}
        >
          Ya lo guardé — continuar al login
        </button>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <label>
        <span>Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={form.email}
          onChange={update('email')}
        />
      </label>

      <label>
        <span>Nombre</span>
        <input type="text" required value={form.name} onChange={update('name')} />
      </label>

      <label>
        <span>Contraseña de login</span>
        <input
          type="password"
          required
          autoComplete="new-password"
          minLength={12}
          value={form.password}
          onChange={update('password')}
        />
        <small>Mínimo 12 caracteres. Se usa para autenticarte con el servidor.</small>
      </label>

      <label>
        <span>Passphrase del vault</span>
        <input
          type="password"
          required
          autoComplete="new-password"
          minLength={12}
          value={form.passphrase}
          onChange={update('passphrase')}
        />
        <small>
          Mínimo 12 caracteres. Encripta tus credenciales E2E.{' '}
          <strong>Si la pierdes, pierdes el vault.</strong>
        </small>
      </label>

      <label>
        <span>Confirma la passphrase</span>
        <input
          type="password"
          required
          autoComplete="new-password"
          value={form.passphraseConfirm}
          onChange={update('passphraseConfirm')}
        />
      </label>

      {error && <p className={styles.error}>{error}</p>}
      {progress && !error && <p className={styles.progress}>{progress}</p>}

      <button type="submit" disabled={pending} className={styles.submit}>
        {pending ? 'Procesando…' : 'Crear cuenta'}
      </button>
    </form>
  );
}
