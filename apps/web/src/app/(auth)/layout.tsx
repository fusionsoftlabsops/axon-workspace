import type { ReactNode } from 'react';
import styles from './layout.module.scss';
import { getServerT } from '@/lib/i18n/server';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getServerT();
  return (
    <div className={styles.shell}>
      <aside className={styles.cover}>
        <div className={styles.coverHeader}>
          <span className={styles.brand}>Axon</span>
          <h1 className={styles.coverTitle}>
            {t('El cuaderno', 'The team’s')}
            <br />
            {t('del equipo.', 'notebook.')}
          </h1>
          <p className={styles.coverDeck}>
            {t(
              'Kanban, vault zero-knowledge y un cerebro curado que vive junto a Claude Code. Una bitácora técnica para devs que prefieren tinta a botones de neón.',
              'Kanban, a zero-knowledge vault, and a curated brain that lives alongside Claude Code. A technical logbook for devs who prefer ink to neon buttons.',
            )}
          </p>
        </div>
        <footer className={styles.coverFooter}>
          self-hosted · open-source · v0.1.0
        </footer>
      </aside>
      <main className={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
          <LocaleSwitcher />
        </div>
        {children}
      </main>
    </div>
  );
}
