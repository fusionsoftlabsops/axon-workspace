import styles from './SignalLine.module.scss';

export type SignalState = 'idle' | 'active' | 'live' | 'failed';

/**
 * The "Signal Console" signature line — a rule carrying a travelling pulse.
 * Presentational + aria-hidden; the surrounding status text carries meaning.
 *
 * - `idle`   — faint static rule (nothing happening)
 * - `active` — violet→cyan pulse travels (building / in-flight)
 * - `live`   — steady green glow (running)
 * - `failed` — broken red dashes (failed)
 */
export function SignalLine({
  state = 'idle',
  className,
}: {
  state?: SignalState;
  className?: string;
}) {
  const variant =
    state === 'active'
      ? styles.active
      : state === 'live'
        ? styles.live
        : state === 'failed'
          ? styles.failed
          : '';
  return (
    <div
      className={`${styles.line} ${variant} ${className ?? ''}`.trim()}
      data-state={state}
      data-testid="signal-line"
      aria-hidden="true"
    />
  );
}
