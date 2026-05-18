import Link from 'next/link';
import { Eyebrow, RuleDivider } from '@/components/ui';
import styles from './not-found.module.scss';

export default function NotFound() {
  return (
    <main className={styles.shell}>
      <article className={styles.composition}>
        <aside className={styles.aside}>
          <Eyebrow ornament="reference" tone="muted" as="div">
            Erratum · página inexistente
          </Eyebrow>
          <p className={styles.kicker}>
            La signatura solicitada no figura en el catálogo. Es posible que la edición se haya
            descontinuado, que el enlace contenga una errata, o que esta página jamás haya sido
            impresa.
          </p>
        </aside>

        <div className={styles.dropcap} aria-hidden>
          <span className={styles.zero}>0</span>
          <span className={styles.crossbar}>4</span>
          <span className={styles.terminal}>0</span>
        </div>

        <section className={styles.body}>
          <h1 className={styles.title}>
            Folio <em>inexistente.</em>
          </h1>

          <p className={styles.lead}>
            Has llegado a una entrada que el cuaderno no registra. Tres opciones para continuar
            sin perder el hilo:
          </p>

          <RuleDivider variant="double" spacing="md" />

          <ol className={styles.options}>
            <li>
              <span className={styles.num}>I.</span>
              <div>
                <strong>Volver al catálogo principal.</strong>{' '}
                <Link href="/projects">→ ir a proyectos</Link>
              </div>
            </li>
            <li>
              <span className={styles.num}>II.</span>
              <div>
                <strong>Iniciar sesión otra vez.</strong>{' '}
                <Link href="/login">→ /login</Link>
              </div>
            </li>
            <li>
              <span className={styles.num}>III.</span>
              <div>
                <strong>Empezar desde la portada.</strong>{' '}
                <Link href="/">→ home</Link>
              </div>
            </li>
          </ol>

          <RuleDivider variant="ornament" spacing="lg" />

          <p className={styles.footnote}>
            ※ Si crees que esto es un error de imprenta, revisa la URL o repórtalo como bug desde
            cualquier tablero activo.
          </p>
        </section>
      </article>
    </main>
  );
}
