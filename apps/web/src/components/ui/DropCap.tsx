import type { ReactNode } from 'react';
import styles from './DropCap.module.scss';

/**
 * DropCap envuelve un nodo de texto y aplica el drop cap a la
 * primera letra del primer párrafo.
 *
 * Uso típico:
 *   <DropCap><p>El primer carácter sale gigante…</p></DropCap>
 *
 * Si necesitas más control (ej. extraer una letra específica),
 * usa la variante `letter` que renderiza solo el capitular.
 */
export function DropCap({
  children,
  letter,
}: {
  children?: ReactNode;
  letter?: string;
}) {
  if (letter) {
    return <span className={styles.standalone} aria-hidden>{letter[0]}</span>;
  }
  return <div className={styles.wrap}>{children}</div>;
}
