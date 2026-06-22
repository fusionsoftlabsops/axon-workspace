'use client';

import { useState } from 'react';
import { useVaultUnlock } from '@/components/vault/UnlockContext';
import { UnlockPrompt } from './UnlockPrompt';
import { CredentialRow } from './CredentialRow';
import { NewCredentialForm } from './NewCredentialForm';
import styles from './vault.module.scss';

export interface CredentialMeta {
  id: string;
  name: string;
  type: string;
  metadataPublic: Record<string, string> | null;
  createdAt: string;
  createdById: string;
  needsRotation: boolean;
  access: Array<{ userId: string; name: string; email: string }>;
}

interface Props {
  projectSlug: string;
  currentUserId: string;
  isAdmin: boolean;
  canCreate: boolean;
  credentials: CredentialMeta[];
}

export function VaultClient({ projectSlug, currentUserId, isAdmin, canCreate, credentials }: Props) {
  const { vault, lock } = useVaultUnlock();
  const [showNew, setShowNew] = useState(false);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h2>Vault</h2>
          <p className={styles.subtitle}>
            {vault
              ? 'Vault desbloqueado. Tu private key vive solo en memoria.'
              : 'Vault bloqueado. Ingresa tu passphrase para desencriptar.'}
          </p>
        </div>
        <div className={styles.headerActions}>
          {vault ? (
            <button className={styles.lockBtn} onClick={lock}>
              🔒 Bloquear vault
            </button>
          ) : null}
          {canCreate && vault && (
            <button className={styles.newBtn} onClick={() => setShowNew((v) => !v)}>
              {showNew ? 'Cancelar' : '+ Nueva credencial'}
            </button>
          )}
        </div>
      </header>

      {!vault && <UnlockPrompt />}

      {vault && showNew && canCreate && (
        <NewCredentialForm
          projectSlug={projectSlug}
          currentUserId={currentUserId}
          onCreated={() => setShowNew(false)}
        />
      )}

      <ul className={styles.list}>
        {credentials.map((c) => (
          <CredentialRow
            key={c.id}
            projectSlug={projectSlug}
            credential={c}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
          />
        ))}
        {credentials.length === 0 && (
          <li className={styles.empty}>
            Aún no tienes credenciales accesibles en este proyecto.
          </li>
        )}
      </ul>
    </div>
  );
}
