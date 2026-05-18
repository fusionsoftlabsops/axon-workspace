import type { ReactNode } from 'react';
import styles from './PullQuote.module.scss';

/**
 * Cita destacada extraída del cuerpo de un artículo. Editorial puro:
 * Newsreader italic, regla vertical en accent-ink, hanging punctuation.
 */
export function PullQuote({
  children,
  cite,
  align = 'left',
}: {
  children: ReactNode;
  cite?: string;
  align?: 'left' | 'right' | 'pull';
}) {
  return (
    <blockquote className={`${styles.quote} ${styles[align]}`} cite={cite}>
      <span aria-hidden className={styles.glyph}>“</span>
      <span className={styles.body}>{children}</span>
      {cite && <cite className={styles.cite}>— {cite}</cite>}
    </blockquote>
  );
}
