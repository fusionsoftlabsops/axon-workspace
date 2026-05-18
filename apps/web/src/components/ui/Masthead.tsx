import type { ReactNode } from 'react';
import styles from './Masthead.module.scss';

/**
 * Masthead — el H1 de una página entera. Fraunces opsz alta, kerning
 * negativo, regla base debajo. Acepta eyebrow + deck para componer
 * la cabecera entera tipo portada de revista.
 */
export function Masthead({
  children,
  eyebrow,
  deck,
  size = 'lg',
  rule = true,
  align = 'left',
}: {
  children: ReactNode;
  eyebrow?: ReactNode;
  deck?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  rule?: boolean;
  align?: 'left' | 'center';
}) {
  return (
    <header className={`${styles.masthead} ${styles[size]} ${styles[align]}`}>
      {eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
      <h1 className={styles.title}>{children}</h1>
      {deck && <p className={styles.deck}>{deck}</p>}
      {rule && <div aria-hidden className={styles.rule} />}
    </header>
  );
}
