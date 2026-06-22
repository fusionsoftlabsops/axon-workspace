'use client';

import { useState, useTransition } from 'react';
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
    if (pass.length < 12) return setError('La nueva passphrase debe tener al menos 12 caracteres');
    if (pass !== confirm) return setError('Las passphrases no coinciden');

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
        setError(err instanceof Error ? err.message : 'No se pudo restablecer');
      } finally {
        if (privateKey) memzero(privateKey);
      }
    });
  }

  if (done) {
    return (
      <div style={box}>
        <h3>Passphrase restablecida</h3>
        <p>Tu nueva passphrase ya está activa. Desbloquea el vault con ella la próxima vez.</p>
      </div>
    );
  }

  return (
    <form style={box} onSubmit={submit}>
      <h3>Olvidé mi passphrase</h3>
      <p>Recupera el vault con tu código de recuperación y define una nueva passphrase.</p>
      <label>
        Código de recuperación
        <input value={code} onChange={(e) => setCode(e.target.value)} required autoComplete="off" />
      </label>
      <label>
        Nueva passphrase
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} minLength={12} required />
      </label>
      <label>
        Confirma la passphrase
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </label>
      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? 'Restableciendo…' : 'Restablecer passphrase'}
      </button>
    </form>
  );
}

function RegenerateCode({ hasRecovery }: { hasRecovery: boolean }) {
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
      <h3>{hasRecovery ? 'Regenerar código de recuperación' : 'Configurar código de recuperación'}</h3>
      <p>
        {hasRecovery
          ? 'Genera un código nuevo (invalida el anterior). Requiere el vault desbloqueado.'
          : 'Esta cuenta aún no tiene código. Genera uno (requiere el vault desbloqueado).'}
      </p>

      {newCode ? (
        <>
          <p>Guárdalo ahora — no se volverá a mostrar:</p>
          <pre style={codeStyle}>{newCode}</pre>
          <button type="button" onClick={() => navigator.clipboard.writeText(newCode)}>
            Copiar código
          </button>
        </>
      ) : vault ? (
        <button type="button" onClick={regenerate} disabled={pending}>
          {pending ? 'Generando…' : 'Generar código nuevo'}
        </button>
      ) : (
        <form onSubmit={doUnlock} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label>
            Desbloquea el vault para continuar
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={pending}>
            {pending ? 'Desbloqueando…' : 'Desbloquear'}
          </button>
        </form>
      )}

      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
    </div>
  );
}
