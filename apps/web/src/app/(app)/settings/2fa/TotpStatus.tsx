'use client';

import { useState, useTransition } from 'react';
import { useI18n } from '@/lib/i18n/i18n';
import { disableTotp } from '@/lib/actions/totp';

export function TotpStatus() {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showDisable, setShowDisable] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await disableTotp(code);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      window.location.reload();
    });
  }

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <p style={{ color: 'var(--color-success)' }}>{t('✓ 2FA activo', '✓ 2FA active')}</p>

      {!showDisable ? (
        <button
          onClick={() => setShowDisable(true)}
          style={{
            marginTop: '1rem',
            padding: '0.5rem 1rem',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            background: 'transparent',
            color: 'var(--color-danger)',
          }}
        >
          {t('Deshabilitar 2FA', 'Disable 2FA')}
        </button>
      ) : (
        <form onSubmit={submit} style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            placeholder={t('Código actual', 'Current code')}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            required
            style={{
              padding: '0.5rem',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              fontFamily: 'var(--font-mono)',
            }}
          />
          <button
            type="submit"
            disabled={pending}
            style={{
              padding: '0.5rem 1rem',
              border: 'none',
              borderRadius: '8px',
              background: 'var(--color-danger)',
              color: 'white',
            }}
          >
            {t('Confirmar', 'Confirm')}
          </button>
          <button
            type="button"
            onClick={() => setShowDisable(false)}
            style={{
              padding: '0.5rem 1rem',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              background: 'transparent',
              color: 'var(--color-fg)',
            }}
          >
            {t('Cancelar', 'Cancel')}
          </button>
        </form>
      )}

      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
    </div>
  );
}
