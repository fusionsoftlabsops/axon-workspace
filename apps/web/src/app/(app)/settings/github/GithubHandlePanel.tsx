'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { useI18n } from '@/lib/i18n/i18n';
import { setGithubLoginAction } from '@/lib/actions/me';

export function GithubHandlePanel({ initial }: { initial: string | null }) {
  const { t } = useI18n();
  const [value, setValue] = useState(initial ?? '');
  const [saved, setSaved] = useState<string | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const r = await setGithubLoginAction(value);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSaved(r.githubLogin);
      setValue(r.githubLogin ?? '');
    });
  }

  const dirty = (value.trim().replace(/^@/, '')) !== (saved ?? '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: '420px', marginTop: '1rem' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--ink-subtle)' }}>{t('Usuario de GitHub', 'GitHub username')}</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="octocat"
          style={{
            border: '1px solid var(--rule-strong)',
            borderRadius: '6px',
            background: 'var(--paper-elev)',
            color: 'var(--ink)',
            padding: '0.5rem 0.65rem',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.9rem',
          }}
        />
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <Button variant="primary" onClick={save} disabled={busy || !dirty}>
          {busy ? t('Guardando…', 'Saving…') : t('Guardar', 'Save')}
        </Button>
        {!busy && saved && !dirty && (
          <span style={{ fontSize: '0.8rem', color: 'var(--ink-muted)' }}>✓ {t('Guardado', 'Saved')}</span>
        )}
        {error && <span style={{ fontSize: '0.8rem', color: 'var(--accent-stamp)' }}>{error}</span>}
      </div>
    </div>
  );
}
