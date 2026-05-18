import type { MouseEventHandler, ReactNode } from 'react';
import styles from './Stat.module.scss';

/**
 * Stat — un número grande en tabular nums Fraunces sobre un label
 * small-caps. Si recibe onClick, se renderiza como botón con
 * indicador visual de "filtro activo".
 */
export function Stat({
  value,
  label,
  hint,
  active,
  trend,
  onClick,
}: {
  value: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  active?: boolean;
  trend?: 'flat' | 'up' | 'down' | 'warn';
  onClick?: MouseEventHandler<HTMLButtonElement>;
}) {
  const cls = [
    styles.stat,
    active ? styles.active : '',
    trend ? styles[`trend-${trend}`] : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick}>
        <span className={styles.value}>{value}</span>
        <span className={styles.label}>{label}</span>
        {hint && <span className={styles.hint}>{hint}</span>}
      </button>
    );
  }

  return (
    <div className={cls}>
      <span className={styles.value}>{value}</span>
      <span className={styles.label}>{label}</span>
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}
