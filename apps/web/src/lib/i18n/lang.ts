/**
 * Primitivas de i18n reutilizables FUERA DE REACT (stores, api clients, hooks).
 * Default inglés. SSR-safe.
 */
export const LANG_KEY = 'axon_lang';
export const LANG_COOKIE = 'axon_lang';
export type Lang = 'es' | 'en';

export function getLang(): Lang {
  if (typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem(LANG_KEY);
      if (saved === 'es' || saved === 'en') return saved;
    } catch {
      /* localStorage inaccesible */
    }
  }
  return 'en';
}

/** Selecciona el valor según el idioma activo. Equivalente imperativo de `t()`. */
export function tr<T>(es: T, en: T): T {
  return getLang() === 'es' ? es : en;
}

/** Tag de locale BCP-47 para formateo de fecha/número. */
export const localeFor = (lang: Lang): string => (lang === 'es' ? 'es-ES' : 'en-US');

/** Persiste el idioma en localStorage Y en cookie (para SSR de <html lang>). */
export function persistLang(lang: Lang): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* ignore */
  }
  try {
    window.document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* ignore */
  }
}
