import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Card.module.scss';

/** Card — a plain elevated surface with a hairline border. The Graphite
 *  workhorse container: clearly separated from the background, no ornament. */
export function Card({
  children,
  interactive = false,
  padded = true,
  className,
  ...rest
}: {
  children: ReactNode;
  interactive?: boolean;
  padded?: boolean;
} & HTMLAttributes<HTMLDivElement>) {
  const cls = [
    styles.card,
    interactive ? styles.interactive : '',
    padded ? styles.padded : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}
