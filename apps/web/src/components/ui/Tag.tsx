'use client';

import type { MouseEventHandler, ReactNode } from 'react';
import styles from './Tag.module.scss';

/**
 * Tag — small-caps Plex con underline puntuado en hover. Variants
 * por color editorial (default ink, accent rojo, marginalia azul).
 *
 * Si onClick está presente se renderiza como botón; si no, como span.
 */
export function Tag({
  children,
  onClick,
  tone = 'ink',
  size = 'md',
  prefix = '#',
}: {
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLElement>;
  tone?: 'ink' | 'accent' | 'marginalia' | 'subtle';
  size?: 'sm' | 'md';
  prefix?: string;
}) {
  const cls = `${styles.tag} ${styles[`tone-${tone}`]} ${styles[`size-${size}`]}`;

  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick}>
        {prefix && <span className={styles.prefix} aria-hidden>{prefix}</span>}
        {children}
      </button>
    );
  }

  return (
    <span className={cls}>
      {prefix && <span className={styles.prefix} aria-hidden>{prefix}</span>}
      {children}
    </span>
  );
}
