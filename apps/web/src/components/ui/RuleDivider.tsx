import styles from './RuleDivider.module.scss';

/**
 * Separador horizontal con tres variantes editoriales:
 *   - single: línea hairline (1px)
 *   - double: doble línea estilo libro técnico (3px double)
 *   - ornament: línea con un asterismo centrado (⁂)
 */
export function RuleDivider({
  variant = 'single',
  spacing = 'md',
}: {
  variant?: 'single' | 'double' | 'ornament';
  spacing?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  if (variant === 'ornament') {
    return (
      <div
        className={`${styles.divider} ${styles.ornament} ${styles[`spacing-${spacing}`]}`}
        role="separator"
      >
        <span className={styles.glyph} aria-hidden>
          ⁂
        </span>
      </div>
    );
  }

  return (
    <hr
      className={`${styles.divider} ${styles[variant]} ${styles[`spacing-${spacing}`]}`}
    />
  );
}
