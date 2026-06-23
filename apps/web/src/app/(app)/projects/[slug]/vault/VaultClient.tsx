'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n/i18n';
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
  const { t } = useI18n();
  const { vault, lock } = useVaultUnlock();
  const [showNew, setShowNew] = useState(false);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h2>{t('Vault', 'Vault')}</h2>
          <p className={styles.subtitle}>
            {vault
              ? t('Vault desbloqueado. Tu private key vive solo en memoria.', 'Vault unlocked. Your private key lives only in memory.')
              : t('Vault bloqueado. Ingresa tu passphrase para desencriptar.', 'Vault locked. Enter your passphrase to decrypt.')}
          </p>
        </div>
        <div className={styles.headerActions}>
          {vault ? (
            <button className={styles.lockBtn} onClick={lock}>
              {t('🔒 Bloquear vault', '🔒 Lock vault')}
            </button>
          ) : null}
          {canCreate && vault && (
            <button className={styles.newBtn} onClick={() => setShowNew((v) => !v)}>
              {showNew ? t('Cancelar', 'Cancel') : t('+ Nueva credencial', '+ New credential')}
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
            {t('Aún no tienes credenciales accesibles en este proyecto.', 'You don’t have any accessible credentials in this project yet.')}
          </li>
        )}
      </ul>
    </div>
  );
}
