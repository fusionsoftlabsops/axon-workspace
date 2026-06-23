'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useI18n } from '@/lib/i18n/i18n';
import { useVaultUnlock } from '@/components/vault/UnlockContext';
import {
  decryptCredentialText,
  encryptCredentialText,
  fromBase64,
  toBase64,
  unwrapDek,
  wrapDekForRecipient,
} from '@/lib/crypto';
import {
  deleteCredentialAction,
  getCredentialAction,
  getProjectMemberKeys,
  revokeCredentialAccessAction,
  rotateCredentialAction,
  shareCredentialAction,
} from '@/lib/actions/credentials';
import type { CredentialMeta } from './VaultClient';
import styles from './vault.module.scss';

export function CredentialRow({
  projectSlug,
  credential,
  currentUserId,
  isAdmin,
}: {
  projectSlug: string;
  credential: CredentialMeta;
  currentUserId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const { vault } = useVaultUnlock();
  const [pending, startTransition] = useTransition();
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    if (!vault) return;
    setError(null);
    const fetched = await getCredentialAction(projectSlug, credential.id);
    if (!fetched.ok) {
      setError(fetched.error);
      return;
    }
    try {
      const dek = unwrapDek(
        fromBase64(fetched.data.wrappedDek),
        vault.publicKey,
        vault.privateKey,
      );
      const text = decryptCredentialText(
        fromBase64(fetched.data.ciphertext),
        fromBase64(fetched.data.nonce),
        dek,
      );
      setPlaintext(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('No se pudo desencriptar', 'Could not decrypt'));
    }
  }

  function hide() {
    setPlaintext(null);
  }

  async function copyToClipboard() {
    if (plaintext == null) return;
    await navigator.clipboard.writeText(plaintext);
  }

  async function share(toUserId: string, publicKeyB64: string) {
    if (!vault) return;
    setError(null);
    const fetched = await getCredentialAction(projectSlug, credential.id);
    if (!fetched.ok) {
      setError(fetched.error);
      return;
    }
    try {
      const dek = unwrapDek(
        fromBase64(fetched.data.wrappedDek),
        vault.publicKey,
        vault.privateKey,
      );
      const wrapped = wrapDekForRecipient(dek, fromBase64(publicKeyB64));
      startTransition(async () => {
        const r = await shareCredentialAction(projectSlug, credential.id, toUserId, toBase64(wrapped));
        if (!r.ok) setError(r.error);
        else router.refresh();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('No se pudo compartir', 'Could not share'));
    }
  }

  function revoke(userId: string) {
    if (!confirm(t('Revocar acceso. Recuerda rotar la credencial real después.', 'Revoke access. Remember to rotate the real credential afterwards.'))) return;
    startTransition(async () => {
      const r = await revokeCredentialAccessAction(projectSlug, credential.id, userId);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  // Re-cifra la credencial con un DEK nuevo y la re-envuelve solo para los
  // miembros con acceso actual: invalida cualquier DEK que un revocado cacheó.
  async function rotate() {
    if (!vault) return;
    if (
      !confirm(
        t(
          'Rotar re-cifra la credencial con una clave nueva e invalida cualquier copia que tuvieran miembros revocados. ¿Continuar?',
          'Rotating re-encrypts the credential with a new key and invalidates any copy that revoked members held. Continue?',
        ),
      )
    ) {
      return;
    }
    setError(null);
    const fetched = await getCredentialAction(projectSlug, credential.id);
    if (!fetched.ok) {
      setError(fetched.error);
      return;
    }
    const keysRes = await getProjectMemberKeys(projectSlug);
    if (!keysRes.ok) {
      setError(keysRes.error);
      return;
    }
    try {
      const dek = unwrapDek(fromBase64(fetched.data.wrappedDek), vault.publicKey, vault.privateKey);
      const text = decryptCredentialText(
        fromBase64(fetched.data.ciphertext),
        fromBase64(fetched.data.nonce),
        dek,
      );
      const enc = encryptCredentialText(text);
      const keyByUser = new Map(keysRes.data.map((m) => [m.userId, m.publicKey]));
      const access = credential.access
        .map((a) => {
          const pk = keyByUser.get(a.userId);
          return pk
            ? { userId: a.userId, wrappedDek: toBase64(wrapDekForRecipient(enc.dek, fromBase64(pk))) }
            : null;
        })
        .filter((x): x is { userId: string; wrappedDek: string } => x !== null);
      startTransition(async () => {
        const r = await rotateCredentialAction(projectSlug, credential.id, {
          ciphertext: toBase64(enc.ciphertext),
          nonce: toBase64(enc.nonce),
          access,
        });
        if (!r.ok) setError(r.error);
        else router.refresh();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('No se pudo rotar', 'Could not rotate'));
    }
  }

  function remove() {
    if (!confirm(t(`Eliminar la credencial "${credential.name}"? Esta acción no se puede deshacer.`, `Delete the credential "${credential.name}"? This action cannot be undone.`))) return;
    startTransition(async () => {
      const r = await deleteCredentialAction(projectSlug, credential.id);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <li className={styles.row}>
      <header className={styles.rowHeader}>
        <div>
          <span className={styles.type}>{credential.type}</span>
          <h4>{credential.name}</h4>
          {credential.needsRotation && (
            <p className={styles.rotateWarning}>{t('⚠ Rotación pendiente — se revocó acceso a un miembro', '⚠ Rotation pending — a member’s access was revoked')}</p>
          )}
          {credential.metadataPublic?.username && (
            <p className={styles.meta}>{credential.metadataPublic.username}</p>
          )}
        </div>
        <div className={styles.rowActions}>
          {!vault && <span className={styles.locked}>{t('🔒 desbloquea el vault', '🔒 unlock the vault')}</span>}
          {vault && plaintext === null && (
            <button onClick={reveal} disabled={pending}>
              {t('Ver secreto', 'Reveal secret')}
            </button>
          )}
          {vault && plaintext !== null && (
            <>
              <code className={styles.secret}>{plaintext}</code>
              <button onClick={copyToClipboard}>{t('Copiar', 'Copy')}</button>
              <button onClick={hide}>{t('Ocultar', 'Hide')}</button>
            </>
          )}
          {vault && (
            <button onClick={() => setShowShare((v) => !v)}>
              {showShare ? t('Cerrar', 'Close') : t('Compartir', 'Share')}
            </button>
          )}
          {vault && credential.needsRotation && (
            <button onClick={rotate} disabled={pending}>
              {t('Rotar ahora', 'Rotate now')}
            </button>
          )}
          {isAdmin && (
            <button className={styles.danger} onClick={remove} disabled={pending}>
              {t('Eliminar', 'Delete')}
            </button>
          )}
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      {showShare && (
        <ShareControls
          projectSlug={projectSlug}
          access={credential.access}
          currentUserId={currentUserId}
          createdById={credential.createdById}
          isAdmin={isAdmin}
          onShare={share}
          onRevoke={revoke}
        />
      )}
    </li>
  );
}

function ShareControls({
  projectSlug,
  access,
  currentUserId,
  createdById,
  isAdmin,
  onShare,
  onRevoke,
}: {
  projectSlug: string;
  access: CredentialMeta['access'];
  currentUserId: string;
  createdById: string;
  isAdmin: boolean;
  onShare: (userId: string, publicKey: string) => void;
  onRevoke: (userId: string) => void;
}) {
  const { t } = useI18n();
  const [members, setMembers] = useState<
    Array<{ userId: string; name: string; email: string; publicKey: string }> | null
  >(null);

  if (members === null) {
    void getProjectMemberKeys(projectSlug).then((r) => {
      if (r.ok) setMembers(r.data);
    });
    return <p style={{ marginTop: '0.5rem' }}>{t('Cargando miembros…', 'Loading members…')}</p>;
  }

  const accessByUser = new Map(access.map((a) => [a.userId, a]));
  const others = members.filter((m) => !accessByUser.has(m.userId));

  return (
    <div className={styles.share}>
      <div>
        <strong>{t('Con acceso:', 'With access:')}</strong>
        <ul>
          {access.map((a) => (
            <li key={a.userId}>
              {a.name} <small>· {a.email}</small>
              {a.userId === createdById && <small> · {t('creador', 'creator')}</small>}
              {a.userId !== currentUserId &&
                a.userId !== createdById &&
                isAdmin && (
                  <button
                    onClick={() => onRevoke(a.userId)}
                    className={styles.danger}
                    style={{ marginLeft: '0.5rem' }}
                  >
                    {t('Revocar', 'Revoke')}
                  </button>
                )}
            </li>
          ))}
        </ul>
      </div>
      {others.length > 0 && (
        <div>
          <strong>{t('Compartir con:', 'Share with:')}</strong>
          <ul>
            {others.map((m) => (
              <li key={m.userId}>
                {m.name} <small>· {m.email}</small>
                <button
                  onClick={() => onShare(m.userId, m.publicKey)}
                  style={{ marginLeft: '0.5rem' }}
                >
                  {t('+ acceso', '+ access')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
