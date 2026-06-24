import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.scss';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

/** Button — clear action hierarchy (audit F4). Primary = filled indigo,
 *  secondary = outlined surface, ghost = quiet, danger = destructive. */
export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  className,
  type = 'button',
  ...rest
}: {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = [
    styles.btn,
    styles[`v-${variant}`],
    styles[`s-${size}`],
    fullWidth ? styles.full : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    // eslint-disable-next-line react/button-has-type
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}
