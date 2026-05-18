import { Eyebrow } from '@/components/ui';
import styles from './loading.module.scss';

/**
 * Loading editorial global. Página esqueleto que evoca una imprenta
 * tirando galeradas: reglas horizontales en cascada + un eyebrow
 * pulsante mientras la página real "se compone" detrás.
 */
export default function Loading() {
  return (
    <div className={styles.shell}>
      <div className={styles.inner}>
        <div className={styles.eyebrow}>
          <Eyebrow ornament="asterism" tone="muted">
            Componiendo galera
          </Eyebrow>
        </div>

        <div className={styles.title}>
          <span className={`${styles.bar} ${styles.bar1}`} aria-hidden />
          <span className={`${styles.bar} ${styles.bar2}`} aria-hidden />
        </div>

        <div className={styles.rule} aria-hidden>
          <div className={styles.ruleFill} />
          <div className={styles.ruleTick} />
        </div>

        <div className={styles.rows}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className={styles.row}
              style={{ '--index': i } as React.CSSProperties}
              aria-hidden
            >
              <span className={styles.rowMeta} />
              <span className={styles.rowTitle} />
              <span className={styles.rowAction} />
            </div>
          ))}
        </div>

        <p className={styles.footnote}>
          <span className={styles.dot} aria-hidden />
          Levantando datos del proyecto
          <span className={styles.ellipsis} aria-hidden>
            ⁂
          </span>
        </p>
      </div>
    </div>
  );
}
