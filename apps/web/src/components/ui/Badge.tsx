import type { ReactNode } from 'react';
import styles from './Badge.module.scss';

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad';

/** Badge — compact status/label chip. Clean sans, soft pill, tonal wash. */
export function Badge({
  children,
  tone = 'neutral',
  dot = false,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
}) {
  return (
    <span className={`${styles.badge} ${styles[`t-${tone}`]}`}>
      {dot && <span aria-hidden className={styles.dot} />}
      {children}
    </span>
  );
}
