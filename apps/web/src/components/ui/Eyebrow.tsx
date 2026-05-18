import type { ReactNode } from 'react';
import styles from './Eyebrow.module.scss';

/**
 * Small-caps Fraunces italic encima de un titular.
 * El convencionalismo editorial: dice DÓNDE estás antes de decir QUÉ.
 */
export function Eyebrow({
  children,
  as: Component = 'span',
  tone = 'muted',
  ornament,
}: {
  children: ReactNode;
  as?: 'span' | 'div' | 'p';
  tone?: 'muted' | 'ink' | 'accent';
  ornament?: 'asterism' | 'section' | 'reference' | 'pilcrow';
}) {
  return (
    <Component className={`${styles.eyebrow} ${styles[tone]}`}>
      {ornament && <span aria-hidden className={styles.ornament}>{ornamentChar(ornament)}</span>}
      {children}
    </Component>
  );
}

function ornamentChar(o: 'asterism' | 'section' | 'reference' | 'pilcrow'): string {
  switch (o) {
    case 'asterism':
      return '⁂';
    case 'section':
      return '§';
    case 'reference':
      return '※';
    case 'pilcrow':
      return '¶';
  }
}
