'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { LlmProvider } from '@prisma/client';
import { useI18n } from '@/lib/i18n/i18n';
import {
  createLlmCredentialAction,
  revokeLlmCredentialAction,
} from '@/lib/actions/llm-credentials';
import styles from './llm-credentials.module.scss';

interface CredRow {
  id: string;
  provider: LlmProvider;
  label: string;
  keyPrefix: string;
  modelDefault: string | null;
  projectId: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

interface ProjectRow {
  id: string;
  slug: string;
  name: string;
}

const PROVIDER_HINTS: Record<LlmProvider, { url: string; label: string }> = {
  ANTHROPIC: { url: 'https://console.anthropic.com', label: 'console.anthropic.com' },
  OPENAI:    { url: 'https://platform.openai.com/api-keys', label: 'platform.openai.com' },
  GOOGLE:    { url: 'https://aistudio.google.com/apikey', label: 'aistudio.google.com' },
  MOONSHOT:  { url: 'https://platform.moonshot.ai/console/api-keys', label: 'platform.moonshot.ai' },
};

export function LlmCredentialsPanel({
  credentials,
  projects,
}: {
  credentials: CredRow[];
  projects: ProjectRow[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [provider, setProvider] = useState<LlmProvider>('ANTHROPIC');
  const [label, setLabel] = useState('');
  const [plainKey, setPlainKey] = useState('');
  const [modelDefault, setModelDefault] = useState('');
  const [projectId, setProjectId] = useState<string>('');

  const onCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await createLlmCredentialAction({
        provider,
        label: label.trim(),
        plainKey: plainKey.trim(),
        modelDefault: modelDefault.trim() || undefined,
        projectId: projectId || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess(t(`Credencial guardada (prefix: ${res.keyPrefix}…)`, `Credential saved (prefix: ${res.keyPrefix}…)`));
      setLabel('');
      setPlainKey('');
      setModelDefault('');
      router.refresh();
    });
  };

  const onRevoke = (id: string) => {
    if (!confirm(t('¿Revocar esta credencial? No es recuperable.', 'Revoke this credential? It cannot be recovered.'))) return;
    startTransition(async () => {
      const res = await revokeLlmCredentialAction(id);
      if (!res.ok) setError(res.error ?? t('no se pudo revocar', 'could not revoke'));
      router.refresh();
    });
  };

  const active = credentials.filter((c) => !c.revokedAt);
  const revoked = credentials.filter((c) => c.revokedAt);

  return (
    <div className={styles.panel}>
      <form className={styles.form} onSubmit={onCreate}>
        <h2>{t('Nueva credencial', 'New credential')}</h2>

        <div className={styles.row}>
          <label>
            {t('Provider', 'Provider')}
            <select value={provider} onChange={(e) => setProvider(e.target.value as LlmProvider)}>
              <option value="ANTHROPIC">Anthropic (Claude)</option>
              <option value="OPENAI">OpenAI (GPT)</option>
              <option value="GOOGLE">Google (Gemini)</option>
              <option value="MOONSHOT">Moonshot (Kimi)</option>
            </select>
          </label>
          <p className={styles.hint}>
            {t('Genera la key en', 'Generate the key at')}{' '}
            <a href={PROVIDER_HINTS[provider].url} target="_blank" rel="noreferrer">
              {PROVIDER_HINTS[provider].label}
            </a>
            .
          </p>
        </div>

        <label>
          {t('Etiqueta', 'Label')}
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t('ej. cuenta personal', 'e.g. personal account')}
            maxLength={80}
            required
          />
        </label>

        <label>
          {t('API key', 'API key')}
          <input
            type="password"
            value={plainKey}
            onChange={(e) => setPlainKey(e.target.value)}
            placeholder="sk-…"
            autoComplete="off"
            required
          />
        </label>

        <label>
          {t('Modelo por defecto', 'Default model')} <span className={styles.optional}>{t('(opcional)', '(optional)')}</span>
          <input
            type="text"
            value={modelDefault}
            onChange={(e) => setModelDefault(e.target.value)}
            placeholder="ej. claude-sonnet-4-6"
            maxLength={100}
          />
        </label>

        <label>
          {t('Limitar a un proyecto', 'Limit to a project')} <span className={styles.optional}>{t('(opcional)', '(optional)')}</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">{t('— Disponible en todos mis proyectos —', '— Available in all my projects —')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>

        {error && <p className={styles.error}>{error}</p>}
        {success && <p className={styles.success}>{success}</p>}

        <button type="submit" disabled={pending || !label.trim() || plainKey.trim().length < 8}>
          {pending ? t('Guardando…', 'Saving…') : t('Guardar credencial', 'Save credential')}
        </button>
      </form>

      <section className={styles.list}>
        <h2>{t('Activas', 'Active')} ({active.length})</h2>
        {active.length === 0 ? (
          <p className={styles.empty}>{t('Aún no hay credenciales activas.', 'No active credentials yet.')}</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('Provider', 'Provider')}</th>
                <th>{t('Etiqueta', 'Label')}</th>
                <th>{t('Key', 'Key')}</th>
                <th>{t('Modelo', 'Model')}</th>
                <th>{t('Último uso', 'Last used')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {active.map((c) => (
                <tr key={c.id}>
                  <td>{c.provider}</td>
                  <td>{c.label}</td>
                  <td><code>{c.keyPrefix}…</code></td>
                  <td>{c.modelDefault ?? '—'}</td>
                  <td>{c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleDateString('es-ES') : t('nunca', 'never')}</td>
                  <td>
                    <button type="button" className={styles.revoke} onClick={() => onRevoke(c.id)}>
                      {t('Revocar', 'Revoke')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {revoked.length > 0 && (
          <details className={styles.revokedList}>
            <summary>{t('Revocadas', 'Revoked')} ({revoked.length})</summary>
            <ul>
              {revoked.map((c) => (
                <li key={c.id}>
                  {c.provider} · {c.label} · <code>{c.keyPrefix}…</code> ·{' '}
                  {c.revokedAt && new Date(c.revokedAt).toLocaleDateString('es-ES')}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
