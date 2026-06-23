import 'server-only';
import { cookies } from 'next/headers';
import { LANG_COOKIE, type Lang } from './lang';

/**
 * i18n para SERVER COMPONENTS (donde `useI18n` no aplica). Lee la cookie
 * `axon_lang` y devuelve un `t(es, en)` ligado a ese idioma. Default inglés.
 *
 *   const t = await getServerT();
 *   return <h1>{t('Iniciar sesión', 'Sign in')}</h1>;
 */
export async function getServerLang(): Promise<Lang> {
  const cookieStore = await cookies();
  return cookieStore.get(LANG_COOKIE)?.value === 'es' ? 'es' : 'en';
}

export async function getServerT(): Promise<<T>(es: T, en: T) => T> {
  const lang = await getServerLang();
  return <T,>(es: T, en: T): T => (lang === 'es' ? es : en);
}
