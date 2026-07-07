import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import styles from './layout.module.scss';
import { getServerT } from '@/lib/i18n/server';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { ThemeToggle } from '@/components/ThemeToggle';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const t = await getServerT();

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/projects" className={styles.brand}>
          Axon
        </Link>
        <nav className={styles.nav}>
          <Link href="/projects">{t('Proyectos', 'Projects')}</Link>
          <Link href="/skills">{t('Skills', 'Skills')}</Link>
          <Link href="/settings/recovery">{t('Recuperación', 'Recovery')}</Link>
          <Link href="/settings/tokens">API tokens</Link>
          <Link href="/settings/llm-credentials">LLM keys</Link>
          <Link href="/settings/github">GitHub</Link>
          {session.user.isMasterUser && <Link href="/settings/invitations">{t('Invitaciones', 'Invitations')}</Link>}
        </nav>
        <div className={styles.user}>
          <ThemeToggle />
          <LocaleSwitcher />
          <span className={styles.userEmail}>{session.user.email}</span>
          <form action="/api/logout" method="post">
            <button type="submit" className={styles.logout}>
              {t('Salir', 'Sign out')}
            </button>
          </form>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
