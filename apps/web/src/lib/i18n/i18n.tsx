'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { LANG_KEY, localeFor, persistLang, type Lang } from './lang';

/* Global, dependency-free i18n. Default English; choice persisted to
   localStorage + cookie (so SSR <html lang>/metadata follow). Strings are
   co-located via t(es, en) — ES first, default render English.
   Outside React use `tr(es, en)` from './lang'. */

export type { Lang } from './lang';

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: <T>(es: T, en: T) => T;
  fmtDate: (ts: string | number | Date) => string;
  fmtDateTime: (ts: string | number | Date) => string;
  fmtNumber: (n: number) => string;
}

const defaultContext: I18nContextValue = {
  lang: 'en',
  setLang: () => {},
  t: (_es, en) => en,
  fmtDate: (ts) => new Date(ts).toLocaleDateString(localeFor('en')),
  fmtDateTime: (ts) => new Date(ts).toLocaleString(localeFor('en')),
  fmtNumber: (n) => n.toLocaleString(localeFor('en')),
};

const I18nContext = createContext<I18nContextValue>(defaultContext);

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'es' || saved === 'en') return saved;
  } catch {
    /* localStorage unavailable (SSR / private mode) */
  }
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    setLangState(initialLang());
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  function setLang(l: Lang) {
    setLangState(l);
    persistLang(l);
  }

  function t<T>(es: T, en: T): T {
    return lang === 'es' ? es : en;
  }

  const locale = localeFor(lang);
  const fmtDate = (ts: string | number | Date) => new Date(ts).toLocaleDateString(locale);
  const fmtDateTime = (ts: string | number | Date) => new Date(ts).toLocaleString(locale);
  const fmtNumber = (n: number) => n.toLocaleString(locale);

  return (
    <I18nContext.Provider value={{ lang, setLang, t, fmtDate, fmtDateTime, fmtNumber }}>
      {children}
    </I18nContext.Provider>
  );
}
