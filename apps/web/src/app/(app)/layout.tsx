import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { logoutAction } from '@/lib/actions/auth';
import styles from './layout.module.scss';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/projects" className={styles.brand}>
          <span className={styles.brandPrefix}>admin · </span>data
        </Link>
        <nav className={styles.nav}>
          <Link href="/projects">Proyectos</Link>
          <Link href="/settings/2fa">2FA</Link>
          <Link href="/settings/recovery">Recuperación</Link>
          <Link href="/settings/tokens">API tokens</Link>
          <Link href="/settings/llm-credentials">LLM keys</Link>
        </nav>
        <div className={styles.user}>
          <span className={styles.userEmail}>{session.user.email}</span>
          <form
            action={async () => {
              'use server';
              await logoutAction();
            }}
          >
            <button type="submit" className={styles.logout}>
              Salir
            </button>
          </form>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
