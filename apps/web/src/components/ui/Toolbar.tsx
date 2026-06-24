import type { ReactNode } from 'react';
import styles from './Toolbar.module.scss';

/** Toolbar — a horizontal strip for filters/search/actions above a list or
 *  board. `start` sits left, `end` right; wraps on small screens. */
export function Toolbar({ start, end }: { start?: ReactNode; end?: ReactNode }) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.start}>{start}</div>
      {end && <div className={styles.end}>{end}</div>}
    </div>
  );
}
