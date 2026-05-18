import type { ReactNode } from 'react';
import styles from './Marginalia.module.scss';

/**
 * Anotación al margen (estilo cuaderno técnico). Se renderiza a la
 * izquierda del flujo principal en pantallas anchas; en mobile cae
 * arriba del bloque como un caption.
 *
 * Componente meramente de presentación — no se posiciona absolute;
 * usa CSS grid template "marginalia content" en el contenedor padre
 * o usa `inline` para flujo en línea.
 */
export function Marginalia({
  children,
  label,
  variant = 'block',
}: {
  children: ReactNode;
  label?: string;
  variant?: 'block' | 'inline';
}) {
  return (
    <aside className={`${styles.marginalia} ${styles[variant]}`}>
      {label && <span className={styles.label}>{label}</span>}
      <span className={styles.body}>{children}</span>
    </aside>
  );
}
