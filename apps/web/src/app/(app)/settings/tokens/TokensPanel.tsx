'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createApiTokenAction, revokeApiTokenAction } from '@/lib/actions/api-tokens';
import type { ApiScope } from '@admin/shared/types';

const SCOPES: ApiScope[] = [
  'projects:read',
  'tasks:read',
  'tasks:write',
  'comments:write',
  'bugs:write',
  'brain:read',
  'brain:write',
  'stories:read',
  'stories:write',
  'repo:read',
];

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  projectSlugs: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export function TokensPanel({
  tokens,
  availableProjects,
}: {
  tokens: TokenRow[];
  availableProjects: Array<{ slug: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Set<ApiScope>>(
    new Set(['tasks:read', 'tasks:write', 'comments:write', 'bugs:write']),
  );
  const [projectSlugs, setProjectSlugs] = useState<Set<string>>(new Set());
  const [created, setCreated] = useState<{ plain: string; prefix: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    startTransition(async () => {
      const r = await createApiTokenAction({
        name,
        scopes: Array.from(scopes),
        projectSlugs: projectSlugs.size > 0 ? Array.from(projectSlugs) : undefined,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setCreated({ plain: r.plainToken, prefix: r.prefix });
      setName('');
      router.refresh();
    });
  }

  function revoke(id: string) {
    if (!confirm('Revocar este token? Cualquier cliente que lo use dejará de funcionar.')) return;
    startTransition(async () => {
      const r = await revokeApiTokenAction(id);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div>
      <form
        onSubmit={submit}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          padding: '1rem',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          marginBottom: '1.5rem',
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontWeight: 500 }}>Nombre</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ej. MCP server - laptop trabajo"
            required
            style={{
              padding: '0.5rem',
              border: '1px solid var(--color-border)',
              borderRadius: '4px',
              background: 'var(--color-bg)',
              color: 'var(--color-fg)',
            }}
          />
        </label>

        <div>
          <strong style={{ fontSize: '0.85rem' }}>Scopes</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.4rem' }}>
            {SCOPES.map((s) => (
              <label
                key={s}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.3rem 0.6rem',
                  border: '1px solid var(--color-border)',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={scopes.has(s)}
                  onChange={(e) => {
                    const next = new Set(scopes);
                    if (e.target.checked) next.add(s);
                    else next.delete(s);
                    setScopes(next);
                  }}
                />
                <code>{s}</code>
              </label>
            ))}
          </div>
        </div>

        <div>
          <strong style={{ fontSize: '0.85rem' }}>Proyectos (vacío = todos los tuyos)</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.4rem' }}>
            {availableProjects.map((p) => (
              <label
                key={p.slug}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.3rem 0.6rem',
                  border: '1px solid var(--color-border)',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                }}
              >
                <input
                  type="checkbox"
                  checked={projectSlugs.has(p.slug)}
                  onChange={(e) => {
                    const next = new Set(projectSlugs);
                    if (e.target.checked) next.add(p.slug);
                    else next.delete(p.slug);
                    setProjectSlugs(next);
                  }}
                />
                {p.name}
              </label>
            ))}
          </div>
        </div>

        {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

        <button
          type="submit"
          disabled={pending || scopes.size === 0 || !name}
          style={{
            padding: '0.6rem 1rem',
            border: 'none',
            borderRadius: '4px',
            background: 'var(--color-accent)',
            color: 'var(--color-accent-fg)',
            fontWeight: 600,
            alignSelf: 'flex-start',
          }}
        >
          {pending ? 'Generando…' : 'Crear token'}
        </button>
      </form>

      {created && (
        <div
          style={{
            padding: '1rem',
            background: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid var(--color-success)',
            borderRadius: '8px',
            marginBottom: '1.5rem',
          }}
        >
          <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>
            ✓ Token creado · cópialo ahora, no se mostrará otra vez
          </p>
          <code
            style={{
              display: 'block',
              padding: '0.75rem',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: '4px',
              wordBreak: 'break-all',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.85rem',
            }}
          >
            {created.plain}
          </code>
          <button
            onClick={() => navigator.clipboard.writeText(created.plain)}
            style={{ marginTop: '0.5rem', padding: '0.4rem 0.75rem' }}
          >
            Copiar
          </button>
        </div>
      )}

      <h2 style={{ fontSize: '1rem', marginTop: '1.5rem' }}>Tokens activos</h2>
      {tokens.length === 0 ? (
        <p style={{ color: 'var(--color-fg-muted)' }}>Aún no has creado tokens.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
              <th style={{ padding: '0.5rem' }}>Nombre</th>
              <th style={{ padding: '0.5rem' }}>Prefijo</th>
              <th style={{ padding: '0.5rem' }}>Scopes</th>
              <th style={{ padding: '0.5rem' }}>Proyectos</th>
              <th style={{ padding: '0.5rem' }}>Último uso</th>
              <th style={{ padding: '0.5rem' }}></th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: '0.5rem' }}>{t.name}</td>
                <td style={{ padding: '0.5rem', fontFamily: 'var(--font-mono)' }}>{t.prefix}…</td>
                <td style={{ padding: '0.5rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                  {t.scopes.join(', ')}
                </td>
                <td style={{ padding: '0.5rem' }}>
                  {t.projectSlugs.length === 0 ? (
                    <span style={{ color: 'var(--color-fg-muted)' }}>todos</span>
                  ) : (
                    t.projectSlugs.join(', ')
                  )}
                </td>
                <td style={{ padding: '0.5rem', color: 'var(--color-fg-muted)' }}>
                  {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : 'nunca'}
                </td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                  <button
                    onClick={() => revoke(t.id)}
                    disabled={pending}
                    style={{
                      padding: '0.3rem 0.75rem',
                      border: '1px solid var(--color-danger)',
                      borderRadius: '4px',
                      background: 'transparent',
                      color: 'var(--color-danger)',
                    }}
                  >
                    Revocar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
