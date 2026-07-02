/**
 * /playground — referencia visual del design system editorial.
 *
 * Pública (no requiere auth) para que el iterador de diseño pueda
 * verla sin tener sesión. Borrable cuando el sistema esté maduro.
 */
import { Eyebrow, RuleDivider, Stat, Tag } from '@/components/ui';
import { Masthead, DropCap, PullQuote, Marginalia } from '@/components/editorial';
import { getServerT } from '@/lib/i18n/server';
import styles from './page.module.scss';

export default async function Playground() {
  const t = await getServerT();
  return (
    <div className={styles.shell}>
      <Masthead
        size="xl"
        eyebrow={<Eyebrow ornament="asterism">Design System · Vol. 1</Eyebrow>}
        deck={t(
          'Una bitácora tipográfica para el dashboard de IA. Cada primitivo aparece en su contexto natural, en la paleta tinta-sobre-papel.',
          'A typographic logbook for the AI dashboard. Each primitive appears in its natural context, in the ink-on-paper palette.',
        )}
      >
        {t('El Cuaderno', 'The Notebook')}
      </Masthead>

      <RuleDivider variant="double" spacing="lg" />

      {/* Eyebrows */}
      <section className={styles.section}>
        <Eyebrow ornament="section" tone="muted">
          Eyebrows
        </Eyebrow>
        <h2 className={styles.h2}>{t('Pequeñas señales antes del titular', 'Small signals before the headline')}</h2>
        <div className={styles.row}>
          <Eyebrow>{t('Sin ornamento', 'No ornament')}</Eyebrow>
          <Eyebrow ornament="asterism">{t('Asterisma', 'Asterism')}</Eyebrow>
          <Eyebrow ornament="section">{t('Sección', 'Section')}</Eyebrow>
          <Eyebrow ornament="reference">{t('Referencia', 'Reference')}</Eyebrow>
          <Eyebrow ornament="pilcrow">Pilcrow</Eyebrow>
          <Eyebrow tone="accent">{t('Acento', 'Accent')}</Eyebrow>
          <Eyebrow tone="ink">{t('Tinta plena', 'Full ink')}</Eyebrow>
        </div>
      </section>

      <RuleDivider variant="ornament" spacing="lg" />

      {/* Tags */}
      <section className={styles.section}>
        <Eyebrow ornament="section">Tags</Eyebrow>
        <h2 className={styles.h2}>{t('Etiquetas con underline puntuado', 'Tags with dotted underline')}</h2>
        <div className={styles.row}>
          <Tag>stripe</Tag>
          <Tag tone="accent">payments</Tag>
          <Tag tone="marginalia">webhook</Tag>
          <Tag tone="subtle">debugging</Tag>
          <Tag prefix="§">{t('capítulo', 'chapter')}</Tag>
          <Tag size="sm">small</Tag>
        </div>
      </section>

      <RuleDivider />

      {/* Stats */}
      <section className={styles.section}>
        <Eyebrow ornament="section">Stats</Eyebrow>
        <h2 className={styles.h2}>{t('Números editoriales con tabular nums', 'Editorial numbers with tabular nums')}</h2>
        <div className={styles.statsRow}>
          <Stat value="42" label={t('memorias activas', 'active memories')} />
          <Stat value="12" label={t('citadas', 'cited')} hint={t('últimos 30 días', 'last 30 days')} trend="up" />
          <Stat value="4" label="stale" hint={t('>6 meses sin uso', '>6 months unused')} trend="warn" />
          <Stat value="$0.18" label={t('costo IA hoy', 'AI cost today')} />
        </div>
      </section>

      <RuleDivider variant="ornament" spacing="xl" />

      {/* Article — drop cap + pull quote */}
      <section className={styles.section}>
        <Eyebrow ornament="pilcrow">{t('Artículo modelo', 'Model article')}</Eyebrow>
        <Masthead
          size="md"
          deck={t(
            'Cómo se ven un párrafo de apertura, una cita extraída y notas al margen.',
            'How an opening paragraph, a pull quote, and marginal notes look.',
          )}
        >
          {t('Idempotencia en webhooks', 'Idempotency in webhooks')}
        </Masthead>

        <article className={styles.article}>
          <DropCap>
            <p>
              {t(
                'Para evitar procesamiento duplicado cuando Stripe retransmite eventos, registramos cada evento en una tabla ',
                'To avoid duplicate processing when Stripe replays events, we record each event in a ',
              )}
              <code>webhook_event_log</code>
              {t(
                ' con la combinación ',
                ' table with the ',
              )}
              <code>(stripe_event_id, tipo)</code>
              {t(
                ' como clave única. Esta es una decisión arquitectónica que se hereda hacia toda la integración de pagos.',
                ' combination as the unique key. This is an architectural decision that propagates throughout the entire payments integration.',
              )}
            </p>
          </DropCap>

          <p>
            {t('La clave es no confiar en el ', 'The key is not to trust the ')}
            <code>amount</code>
            {t(
              ' del payload del webhook directamente, sino contrastarlo siempre contra el monto persistido en nuestra propia base de datos. Stripe puede redondear internamente.',
              ' from the webhook payload directly, but to always check it against the amount persisted in our own database. Stripe may round internally.',
            )}
          </p>

          <PullQuote cite="Bitácora del proyecto · 2026-05-17">
            {t(
              'El reverse proxy normaliza los headers a minúsculas: validar la firma asumiendo capitalización exacta cuesta dos horas de debugging y un café frío.',
              'The reverse proxy normalizes headers to lowercase: validating the signature assuming exact capitalization costs two hours of debugging and a cold coffee.',
            )}
          </PullQuote>

          <p>
            {t(
              'En el resto del módulo, cada nueva integración debe seguir el mismo patrón. La auditoría queda en el cerebro principal del proyecto, citable desde cualquier tarea futura por su id de memoria.',
              "In the rest of the module, every new integration must follow the same pattern. The audit trail lives in the project's main brain, citable from any future task by its memory id.",
            )}
          </p>
        </article>

        <div className={styles.marginaliaWrap}>
          <Marginalia label={t('Decisión', 'Decision')} variant="block">
            {t(
              'Aprobada el 17 de mayo de 2026 tras revisar el incidente STR-014.',
              'Approved on May 17, 2026 after reviewing incident STR-014.',
            )}
          </Marginalia>
          <Marginalia label={t('Origen', 'Source')} variant="block">
            {t(
              'Memoria #M-3 · publicada por Manuel desde la tarea PROJ-2.',
              'Memory #M-3 · published by Manuel from task PROJ-2.',
            )}
          </Marginalia>
        </div>
      </section>

      <RuleDivider variant="double" spacing="xl" />

      {/* Type scale referencia */}
      <section className={styles.section}>
        <Eyebrow ornament="reference">{t('Tipografía', 'Typography')}</Eyebrow>
        <div className={styles.typeScale}>
          <p className={styles.t5}>Display · 80 / 0.95 — Fraunces WONK opsz 144</p>
          <p className={styles.t4}>Masthead · 56 / 1.0</p>
          <p className={styles.t3}>Section · 40 / 1.1</p>
          <p className={styles.t2}>H2 · 30 / 1.2</p>
          <p className={styles.t1}>H3 · 24 / 1.25</p>
          <p className={styles.tBody}>
            {t(
              'Body editorial · Newsreader · 17 / 1.7. Pensado para lectura larga de memorias técnicas. La itálica se reserva para citas y deck.',
              'Editorial body · Newsreader · 17 / 1.7. Designed for long reading of technical memories. Italics are reserved for quotes and decks.',
            )}
          </p>
          <p className={styles.tUi}>UI sans · Hanken Grotesk · 15 / 1.5.</p>
          <p className={styles.tMono}>
            <code>mono · JetBrains Mono · 14 / 1.5 · ad_pk_q2tOIkHL0OJp9_kK</code>
          </p>
        </div>
      </section>
    </div>
  );
}
