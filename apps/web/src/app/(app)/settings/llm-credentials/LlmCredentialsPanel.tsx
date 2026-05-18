'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { LlmProvider } from '@prisma/client';
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
      setSuccess(`Credencial guardada (prefix: ${res.keyPrefix}…)`);
      setLabel('');
      setPlainKey('');
      setModelDefault('');
      router.refresh();
    });
  };

  const onRevoke = (id: string) => {
    if (!confirm('¿Revocar esta credencial? No es recuperable.')) return;
    startTransition(async () => {
      const res = await revokeLlmCredentialAction(id);
      if (!res.ok) setError(res.error ?? 'no se pudo revocar');
      router.refresh();
    });
  };

  const active = credentials.filter((c) => !c.revokedAt);
  const revoked = credentials.filter((c) => c.revokedAt);

  return (
    <div className={styles.panel}>
      <form className={styles.form} onSubmit={onCreate}>
        <h2>Nueva credencial</h2>

        <div className={styles.row}>
          <label>
            Provider
            <select value={provider} onChange={(e) => setProvider(e.target.value as LlmProvider)}>
              <option value="ANTHROPIC">Anthropic (Claude)</option>
              <option value="OPENAI">OpenAI (GPT)</option>
              <option value="GOOGLE">Google (Gemini)</option>
              <option value="MOONSHOT">Moonshot (Kimi)</option>
            </select>
          </label>
          <p className={styles.hint}>
            Genera la key en{' '}
            <a href={PROVIDER_HINTS[provider].url} target="_blank" rel="noreferrer">
              {PROVIDER_HINTS[provider].label}
            </a>
            .
          </p>
        </div>

        <label>
          Etiqueta
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="ej. cuenta personal"
            maxLength={80}
            required
          />
        </label>

        <label>
          API key
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
          Modelo por defecto <span className={styles.optional}>(opcional)</span>
          <input
            type="text"
            value={modelDefault}
            onChange={(e) => setModelDefault(e.target.value)}
            placeholder="ej. claude-sonnet-4-6"
            maxLength={100}
          />
        </label>

        <label>
          Limitar a un proyecto <span className={styles.optional}>(opcional)</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">— Disponible en todos mis proyectos —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>

        {error && <p className={styles.error}>{error}</p>}
        {success && <p className={styles.success}>{success}</p>}

        <button type="submit" disabled={pending || !label.trim() || plainKey.trim().length < 8}>
          {pending ? 'Guardando…' : 'Guardar credencial'}
        </button>
      </form>

      <section className={styles.list}>
        <h2>Activas ({active.length})</h2>
        {active.length === 0 ? (
          <p className={styles.empty}>Aún no hay credenciales activas.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Etiqueta</th>
                <th>Key</th>
                <th>Modelo</th>
                <th>Último uso</th>
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
                  <td>{c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleDateString('es-ES') : 'nunca'}</td>
                  <td>
                    <button type="button" className={styles.revoke} onClick={() => onRevoke(c.id)}>
                      Revocar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {revoked.length > 0 && (
          <details className={styles.revokedList}>
            <summary>Revocadas ({revoked.length})</summary>
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
