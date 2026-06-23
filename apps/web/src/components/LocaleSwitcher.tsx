'use client';

import { useI18n, type Lang } from '@/lib/i18n/i18n';

/** EN/ES language toggle. Persists via the i18n context (localStorage + cookie).
 *  Editorial styling: ink-on-paper, mono, active is bold ink / inactive subtle. */
export function LocaleSwitcher() {
  const { lang, setLang, t } = useI18n();
  const langs: Lang[] = ['en', 'es'];

  return (
    <div
      role="group"
      aria-label={t('Idioma', 'Language')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.72rem',
        letterSpacing: '0.08em',
      }}
    >
      {langs.map((l, i) => (
        <span key={l} style={{ display: 'inline-flex', alignItems: 'center' }}>
          {i > 0 && (
            <span aria-hidden="true" style={{ color: 'var(--ink-subtle)', margin: '0 0.4rem' }}>
              ·
            </span>
          )}
          <button
            type="button"
            onClick={() => setLang(l)}
            aria-pressed={lang === l}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              textTransform: 'uppercase',
              color: lang === l ? 'var(--ink)' : 'var(--ink-subtle)',
              fontWeight: lang === l ? 700 : 500,
            }}
          >
            {l}
          </button>
        </span>
      ))}
    </div>
  );
}
