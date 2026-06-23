'use client';

import { useState, useTransition } from 'react';
import { useI18n } from '@/lib/i18n/i18n';
import { useVaultUnlock } from '@/components/vault/UnlockContext';
import {
  generateRecoveryCode,
  memzero,
  recoverPrivateKey,
  recoveryCodeProof,
  toBase64,
  fromBase64,
  wrapPrivateKeyWithPassphrase,
  wrapPrivateKeyWithRecoveryCode,
} from '@/lib/crypto';
import { getSelfRecoveryMaterial } from '@/lib/actions/me';
import {
  resetPassphraseWithRecoveryAction,
  setRecoveryCodeAction,
} from '@/lib/actions/recovery';

const box: React.CSSProperties = {
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  padding: '1.25rem',
  marginTop: '1.5rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
};
const codeStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '1.05rem',
  letterSpacing: '0.05em',
  textAlign: 'center',
  padding: '1rem',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  userSelect: 'all',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};

export function RecoveryPanel({ hasRecovery }: { hasRecovery: boolean }) {
  return (
    <>
      <ResetWithCode />
      <RegenerateCode hasRecovery={hasRecovery} />
    </>
  );
}

function ResetWithCode() {
  const { t } = useI18n();
  const { lock } = useVaultUnlock();
  const [code, setCode] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pass.length < 12) return setError(t('La nueva passphrase debe tener al menos 12 caracteres', 'The new passphrase must be at least 12 characters'));
    if (pass !== confirm) return setError(t('Las passphrases no coinciden', 'The passphrases do not match'));

    startTransition(async () => {
      const mat = await getSelfRecoveryMaterial();
      if (!mat.ok) return setError(mat.error);
      let privateKey: Uint8Array | null = null;
      try {
        privateKey = recoverPrivateKey(code, {
          encryptedPrivKeyRecovery: fromBase64(mat.data.encryptedPrivKeyRecovery),
          recoveryPrivKeyNonce: fromBase64(mat.data.recoveryPrivKeyNonce),
          recoveryKdfSalt: fromBase64(mat.data.recoveryKdfSalt),
        });
        const sealed = wrapPrivateKeyWithPassphrase(privateKey, pass);
        const r = await resetPassphraseWithRecoveryAction({
          recoveryHash: recoveryCodeProof(code),
          encryptedPrivateKey: toBase64(sealed.encryptedPrivateKey),
          encryptedPrivKeyNonce: toBase64(sealed.encryptedPrivKeyNonce),
          kdfSalt: toBase64(sealed.kdfSalt),
        });
        if (!r.ok) return setError(r.error);
        lock(); // forzar re-desbloqueo con la nueva passphrase
        setDone(true);
        setCode('');
        setPass('');
        setConfirm('');
      } catch (err) {
        setError(err instanceof Error ? err.message : t('No se pudo restablecer', 'Could not reset'));
      } finally {
        if (privateKey) memzero(privateKey);
      }
    });
  }

  if (done) {
    return (
      <div style={box}>
        <h3>{t('Passphrase restablecida', 'Passphrase reset')}</h3>
        <p>{t('Tu nueva passphrase ya está activa. Desbloquea el vault con ella la próxima vez.', 'Your new passphrase is now active. Unlock the vault with it next time.')}</p>
      </div>
    );
  }

  return (
    <form style={box} onSubmit={submit}>
      <h3>{t('Olvidé mi passphrase', 'I forgot my passphrase')}</h3>
      <p>{t('Recupera el vault con tu código de recuperación y define una nueva passphrase.', 'Recover the vault with your recovery code and set a new passphrase.')}</p>
      <label>
        {t('Código de recuperación', 'Recovery code')}
        <input value={code} onChange={(e) => setCode(e.target.value)} required autoComplete="off" />
      </label>
      <label>
        {t('Nueva passphrase', 'New passphrase')}
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} minLength={12} required />
      </label>
      <label>
        {t('Confirma la passphrase', 'Confirm the passphrase')}
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </label>
      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? t('Restableciendo…', 'Resetting…') : t('Restablecer passphrase', 'Reset passphrase')}
      </button>
    </form>
  );
}

function RegenerateCode({ hasRecovery }: { hasRecovery: boolean }) {
  const { t } = useI18n();
  const { vault, unlock } = useVaultUnlock();
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function doUnlock(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await unlock(passphrase);
      if (!r.ok) setError(r.error);
      setPassphrase('');
    });
  }

  function regenerate() {
    if (!vault) return;
    setError(null);
    const code = generateRecoveryCode();
    const blob = wrapPrivateKeyWithRecoveryCode(vault.privateKey, code);
    startTransition(async () => {
      const r = await setRecoveryCodeAction({
        recoveryHash: recoveryCodeProof(code),
        encryptedPrivKeyRecovery: toBase64(blob.encryptedPrivKeyRecovery),
        recoveryPrivKeyNonce: toBase64(blob.recoveryPrivKeyNonce),
        recoveryKdfSalt: toBase64(blob.recoveryKdfSalt),
      });
      if (!r.ok) return setError(r.error);
      setNewCode(code);
    });
  }

  return (
    <div style={box}>
      <h3>{hasRecovery ? t('Regenerar código de recuperación', 'Regenerate recovery code') : t('Configurar código de recuperación', 'Set up recovery code')}</h3>
      <p>
        {hasRecovery
          ? t('Genera un código nuevo (invalida el anterior). Requiere el vault desbloqueado.', 'Generate a new code (invalidates the previous one). Requires the vault unlocked.')
          : t('Esta cuenta aún no tiene código. Genera uno (requiere el vault desbloqueado).', 'This account does not have a code yet. Generate one (requires the vault unlocked).')}
      </p>

      {newCode ? (
        <>
          <p>{t('Guárdalo ahora — no se volverá a mostrar:', 'Save it now — it will not be shown again:')}</p>
          <pre style={codeStyle}>{newCode}</pre>
          <button type="button" onClick={() => navigator.clipboard.writeText(newCode)}>
            {t('Copiar código', 'Copy code')}
          </button>
        </>
      ) : vault ? (
        <button type="button" onClick={regenerate} disabled={pending}>
          {pending ? t('Generando…', 'Generating…') : t('Generar código nuevo', 'Generate new code')}
        </button>
      ) : (
        <form onSubmit={doUnlock} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label>
            {t('Desbloquea el vault para continuar', 'Unlock the vault to continue')}
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={pending}>
            {pending ? t('Desbloqueando…', 'Unlocking…') : t('Desbloquear', 'Unlock')}
          </button>
        </form>
      )}

      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
    </div>
  );
}
