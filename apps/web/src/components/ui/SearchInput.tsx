import type { InputHTMLAttributes } from 'react';
import styles from './SearchInput.module.scss';

/** SearchInput — a search field with a leading glyph. Scannable, high-contrast. */
export function SearchInput({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`${styles.wrap} ${className ?? ''}`}>
      <span aria-hidden className={styles.icon}>⌕</span>
      <input type="search" className={styles.input} {...rest} />
    </div>
  );
}
