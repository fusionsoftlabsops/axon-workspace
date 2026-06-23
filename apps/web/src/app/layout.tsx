import type { Metadata } from 'next';
import { Fraunces, Newsreader, IBM_Plex_Sans, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { Providers } from './providers';
import { LANG_COOKIE, type Lang } from '@/lib/i18n/lang';
import './globals.scss';

// Display serif — dramático para mastheads y drop caps. Variable axes:
// opsz (12-144), wght (100-900), soft (0-100), WONK (0-1).
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display',
  axes: ['opsz', 'SOFT', 'WONK'],
});

// Editorial serif — body de memorias largas y pull quotes.
const newsreader = Newsreader({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-editorial',
  style: ['normal', 'italic'],
});

// UI sans — neutral con character. Navegación, botones, labels.
const plex = IBM_Plex_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
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
  const fontClasses = [
    fraunces.variable,
    newsreader.variable,
    plex.variable,
    mono.variable,
  ].join(' ');

  return (
    <html lang={lang} className={fontClasses}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
