import type { ReactNode } from 'react';
import styles from './EmptyState.module.scss';

/** EmptyState — an invitation to act, not a dead end (audit: "una pantalla
 *  vacía es una invitación a actuar"). Title + optional hint + a single CTA. */
export function EmptyState({
  title,
  hint,
  action,
  compact = false,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`${styles.empty} ${compact ? styles.compact : ''}`}>
      <p className={styles.title}>{title}</p>
      {hint && <p className={styles.hint}>{hint}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
