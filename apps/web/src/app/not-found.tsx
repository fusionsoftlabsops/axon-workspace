import Link from 'next/link';
import { Eyebrow, RuleDivider } from '@/components/ui';
import { getServerT } from '@/lib/i18n/server';
import styles from './not-found.module.scss';

export default async function NotFound() {
  const t = await getServerT();
  return (
    <main className={styles.shell}>
      <article className={styles.composition}>
        <aside className={styles.aside}>
          <Eyebrow ornament="reference" tone="muted" as="div">
            {t('Erratum · página inexistente', 'Erratum · page not found')}
          </Eyebrow>
          <p className={styles.kicker}>
            {t(
              'La signatura solicitada no figura en el catálogo. Es posible que la edición se haya descontinuado, que el enlace contenga una errata, o que esta página jamás haya sido impresa.',
              'The requested shelfmark does not appear in the catalog. The edition may have been discontinued, the link may contain a typo, or this page may never have been printed.',
            )}
          </p>
        </aside>

        <div className={styles.dropcap} aria-hidden>
          <span className={styles.zero}>0</span>
          <span className={styles.crossbar}>4</span>
          <span className={styles.terminal}>0</span>
        </div>

        <section className={styles.body}>
          <h1 className={styles.title}>
            {t('Folio ', 'Folio ')}
            <em>{t('inexistente.', 'not found.')}</em>
          </h1>

          <p className={styles.lead}>
            {t(
              'Has llegado a una entrada que el cuaderno no registra. Tres opciones para continuar sin perder el hilo:',
              'You have reached an entry the notebook does not record. Three options to carry on without losing the thread:',
            )}
          </p>

          <RuleDivider variant="double" spacing="md" />

          <ol className={styles.options}>
            <li>
              <span className={styles.num}>I.</span>
              <div>
                <strong>{t('Volver al catálogo principal.', 'Return to the main catalog.')}</strong>{' '}
                <Link href="/projects">{t('→ ir a proyectos', '→ go to projects')}</Link>
              </div>
            </li>
            <li>
              <span className={styles.num}>II.</span>
              <div>
                <strong>{t('Iniciar sesión otra vez.', 'Sign in again.')}</strong>{' '}
                <Link href="/login">→ /login</Link>
              </div>
            </li>
            <li>
              <span className={styles.num}>III.</span>
              <div>
                <strong>{t('Empezar desde la portada.', 'Start from the home page.')}</strong>{' '}
                <Link href="/">→ home</Link>
              </div>
            </li>
          </ol>

          <RuleDivider variant="ornament" spacing="lg" />

          <p className={styles.footnote}>
            {t(
              '※ Si crees que esto es un error de imprenta, revisa la URL o repórtalo como bug desde cualquier tablero activo.',
              '※ If you think this is a printing error, check the URL or report it as a bug from any active board.',
            )}
          </p>
        </section>
      </article>
    </main>
  );
}
