import type { ReactNode } from 'react';
import styles from './layout.module.scss';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <aside className={styles.cover}>
        <div className={styles.coverHeader}>
          <span className={styles.brand}>※ admin · data · project</span>
          <h1 className={styles.coverTitle}>
            El cuaderno
            <br />
            del equipo.
          </h1>
          <p className={styles.coverDeck}>
            Kanban, vault zero-knowledge y un cerebro curado que vive junto a Claude Code. Una
            bitácora técnica para devs que prefieren tinta a botones de neón.
          </p>
        </div>
        <footer className={styles.coverFooter}>
          self-hosted · open-source · v0.1.0
        </footer>
      </aside>
      <main className={styles.card}>{children}</main>
    </div>
  );
}
