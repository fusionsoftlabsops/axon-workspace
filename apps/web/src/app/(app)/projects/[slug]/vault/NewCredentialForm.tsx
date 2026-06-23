'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n/i18n';
import { useVaultUnlock } from '@/components/vault/UnlockContext';
import {
  encryptAndShareCredential,
  fromBase64,
  toBase64,
} from '@/lib/crypto';
import { createCredentialAction, getProjectMemberKeys } from '@/lib/actions/credentials';
import styles from './vault.module.scss';

type CredType = 'EMAIL_LOGIN' | 'PASSWORD' | 'API_KEY' | 'SSH_KEY' | 'NOTE' | 'CERT';

interface MemberKey {
  userId: string;
  name: string;
  email: string;
  publicKey: string; // base64
}

export function NewCredentialForm({
  projectSlug,
  currentUserId,
  onCreated,
}: {
  projectSlug: string;
  currentUserId: string;
  onCreated: () => void;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const { vault } = useVaultUnlock();
  const [pending, startTransition] = useTransition();

  const [members, setMembers] = useState<MemberKey[] | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<CredType>('PASSWORD');
  const [secret, setSecret] = useState('');
  const [meta, setMeta] = useState({ username: '', url: '' });
  const [shareWith, setShareWith] = useState<Set<string>>(new Set([currentUserId]));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await getProjectMemberKeys(projectSlug);
      if (cancelled) return;
      if (r.ok) setMembers(r.data);
      else setError(r.error);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectSlug]);

  if (!vault) return null;

  function toggleShare(userId: string) {
    if (userId === currentUserId) return; // can't deselect self
    setShareWith((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!members) return;
    if (!vault) return;

    const recipients = members
      .filter((m) => shareWith.has(m.userId))
      .map((m) => ({ userId: m.userId, publicKey: fromBase64(m.publicKey) }));

    if (recipients.length === 0) {
      setError(t('Debes compartir contigo mismo al menos', 'You must at least share with yourself'));
      return;
    }

    const { ciphertext, nonce, access } = encryptAndShareCredential(secret, recipients);

    const metadataPublic: Record<string, string> = {};
    if (meta.username) metadataPublic.username = meta.username;
    if (meta.url) metadataPublic.url = meta.url;

    startTransition(async () => {
      const r = await createCredentialAction(projectSlug, {
        name,
        type,
        ciphertext: toBase64(ciphertext),
        nonce: toBase64(nonce),
        metadataPublic: Object.keys(metadataPublic).length ? metadataPublic : undefined,
        access: access.map((a) => ({
          userId: a.userId,
          wrappedDek: toBase64(a.wrappedDek),
        })),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setName('');
      setSecret('');
      setMeta({ username: '', url: '' });
      onCreated();
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className={styles.newCred}>
      <h3>{t('Nueva credencial', 'New credential')}</h3>
      <div className={styles.grid2}>
        <label>
          <span>{t('Nombre', 'Name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          <span>{t('Tipo', 'Type')}</span>
          <select value={type} onChange={(e) => setType(e.target.value as CredType)}>
            <option value="EMAIL_LOGIN">{t('Email + login', 'Email + login')}</option>
            <option value="PASSWORD">{t('Password', 'Password')}</option>
            <option value="API_KEY">{t('API key', 'API key')}</option>
            <option value="SSH_KEY">{t('SSH key', 'SSH key')}</option>
            <option value="CERT">{t('Certificado', 'Certificate')}</option>
            <option value="NOTE">{t('Nota segura', 'Secure note')}</option>
          </select>
        </label>
        <label>
          <span>{t('Username / cuenta (metadata pública)', 'Username / account (public metadata)')}</span>
          <input value={meta.username} onChange={(e) => setMeta((m) => ({ ...m, username: e.target.value }))} />
        </label>
        <label>
          <span>{t('URL (metadata pública)', 'URL (public metadata)')}</span>
          <input value={meta.url} onChange={(e) => setMeta((m) => ({ ...m, url: e.target.value }))} />
        </label>
      </div>
      <label>
        <span>{t('Secreto (se encripta en este navegador antes de enviarlo)', 'Secret (encrypted in this browser before sending)')}</span>
        <textarea
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          required
          rows={3}
        />
      </label>

      <div className={styles.shareSection}>
        <strong>{t('Compartir con:', 'Share with:')}</strong>
        {members === null && <p>{t('Cargando miembros…', 'Loading members…')}</p>}
        {members?.map((m) => (
          <label key={m.userId} className={styles.checkbox}>
            <input
              type="checkbox"
              checked={shareWith.has(m.userId)}
              disabled={m.userId === currentUserId}
              onChange={() => toggleShare(m.userId)}
            />
            <span>
              {m.name}
              <small> · {m.email}</small>
              {m.userId === currentUserId && <small> {t('(tú)', '(you)')}</small>}
            </span>
          </label>
        ))}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <button type="submit" disabled={pending || !members}>
        {pending ? t('Encriptando + guardando…', 'Encrypting + saving…') : t('Crear credencial', 'Create credential')}
      </button>
    </form>
  );
}
