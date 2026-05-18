/**
 * Ruta privada para previsualizar el componente de loading.tsx sin
 * tener que disparar una navegación lenta. Renderiza el mismo árbol
 * que Next.js mostraría como esqueleto. Borrable.
 */
import Loading from '../loading';

export default function LoadingPreview() {
  return <Loading />;
}
