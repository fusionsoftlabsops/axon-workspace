import type { Metadata } from 'next';
import { Hanken_Grotesk, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { Providers } from './providers';
import { LANG_COOKIE, type Lang } from '@/lib/i18n/lang';
import { THEME_COOKIE, type Theme } from '@/lib/theme';
import './globals.scss';

// Sistema "Corporate Precision": una sola familia (Hanken Grotesk) para
// títulos, navegación, botones y cuerpo — profesional, técnica, sin mezclar
// voces tipográficas.
const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-hanken',
  weight: ['400', '500', '600', '700'],
});

// Mono — datos tabulares, IDs, código.
const mono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
  weight: ['400', '500', '600'],
});

async function serverLang(): Promise<Lang> {
  const cookieStore = await cookies();
  return cookieStore.get(LANG_COOKIE)?.value === 'es' ? 'es' : 'en';
}

async function serverTheme(): Promise<Theme> {
  const cookieStore = await cookies();
  return cookieStore.get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
}

export async function generateMetadata(): Promise<Metadata> {
  const isEs = (await serverLang()) === 'es';
  return {
    title: 'Axon',
    description: isEs
      ? 'Plataforma multi-proyecto con vault E2E e integración Claude Code.'
      : 'Multi-project platform with E2E vault and Claude Code integration.',
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = await serverLang();
  const theme = await serverTheme();
  const fontClasses = [hanken.variable, mono.variable].join(' ');

  return (
    <html lang={lang} data-theme={theme} className={fontClasses}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
