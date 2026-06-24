'use client';

import { useEffect, useState } from 'react';
import { THEME_COOKIE, type Theme } from '@/lib/theme';
import { useI18n } from '@/lib/i18n/i18n';

/** Explicit, persistent light/dark toggle. Writes `data-theme` on <html> and a
 *  cookie so the server renders the right theme with no flash. Styling mirrors
 *  the LocaleSwitcher (mono, ink-on-surface). */
export function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme>('light');

  // Sync from the attribute the server set, so SSR stays the source of truth.
  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'dark' : 'light');
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  const dark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      aria-label={dark ? t('Cambiar a modo claro', 'Switch to light mode') : t('Cambiar a modo oscuro', 'Switch to dark mode')}
      title={dark ? t('Modo claro', 'Light mode') : t('Modo oscuro', 'Dark mode')}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.85rem',
        lineHeight: 1,
        color: 'var(--ink-subtle)',
      }}
    >
      {dark ? '☀' : '☾'}
    </button>
  );
}
