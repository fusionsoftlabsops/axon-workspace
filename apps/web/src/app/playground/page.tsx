/**
 * /playground — referencia visual del design system editorial.
 *
 * Pública (no requiere auth) para que el iterador de diseño pueda
 * verla sin tener sesión. Borrable cuando el sistema esté maduro.
 */
import { Eyebrow, Masthead, RuleDivider, DropCap, PullQuote, Marginalia, Stat, Tag } from '@/components/ui';
import styles from './page.module.scss';

export default function Playground() {
  return (
    <div className={styles.shell}>
      <Masthead
        size="xl"
        eyebrow={<Eyebrow ornament="asterism">Design System · Vol. 1</Eyebrow>}
        deck="Una bitácora tipográfica para el dashboard de IA. Cada primitivo aparece en su contexto natural, en la paleta tinta-sobre-papel."
      >
        El Cuaderno
      </Masthead>

      <RuleDivider variant="double" spacing="lg" />

      {/* Eyebrows */}
      <section className={styles.section}>
        <Eyebrow ornament="section" tone="muted">
          Eyebrows
        </Eyebrow>
        <h2 className={styles.h2}>Pequeñas señales antes del titular</h2>
        <div className={styles.row}>
          <Eyebrow>Sin ornamento</Eyebrow>
          <Eyebrow ornament="asterism">Asterisma</Eyebrow>
          <Eyebrow ornament="section">Sección</Eyebrow>
          <Eyebrow ornament="reference">Referencia</Eyebrow>
          <Eyebrow ornament="pilcrow">Pilcrow</Eyebrow>
          <Eyebrow tone="accent">Acento</Eyebrow>
          <Eyebrow tone="ink">Tinta plena</Eyebrow>
        </div>
      </section>

      <RuleDivider variant="ornament" spacing="lg" />

      {/* Tags */}
      <section className={styles.section}>
        <Eyebrow ornament="section">Tags</Eyebrow>
        <h2 className={styles.h2}>Etiquetas con underline puntuado</h2>
        <div className={styles.row}>
          <Tag>stripe</Tag>
          <Tag tone="accent">payments</Tag>
          <Tag tone="marginalia">webhook</Tag>
          <Tag tone="subtle">debugging</Tag>
          <Tag prefix="§">capítulo</Tag>
          <Tag size="sm">small</Tag>
        </div>
      </section>

      <RuleDivider />

      {/* Stats */}
      <section className={styles.section}>
        <Eyebrow ornament="section">Stats</Eyebrow>
        <h2 className={styles.h2}>Números editoriales con tabular nums</h2>
        <div className={styles.statsRow}>
          <Stat value="42" label="memorias activas" />
          <Stat value="12" label="citadas" hint="últimos 30 días" trend="up" />
          <Stat value="4" label="stale" hint=">6 meses sin uso" trend="warn" />
          <Stat value="$0.18" label="costo IA hoy" />
        </div>
      </section>

      <RuleDivider variant="ornament" spacing="xl" />

      {/* Article — drop cap + pull quote */}
      <section className={styles.section}>
        <Eyebrow ornament="pilcrow">Artículo modelo</Eyebrow>
        <Masthead
          size="md"
          deck="Cómo se ven un párrafo de apertura, una cita extraída y notas al margen."
        >
          Idempotencia en webhooks
        </Masthead>

        <article className={styles.article}>
          <DropCap>
            <p>
              Para evitar procesamiento duplicado cuando Stripe retransmite eventos,
              registramos cada evento en una tabla <code>webhook_event_log</code> con la
              combinación <code>(stripe_event_id, tipo)</code> como clave única. Esta es
              una decisión arquitectónica que se hereda hacia toda la integración de pagos.
            </p>
          </DropCap>

          <p>
            La clave es no confiar en el <code>amount</code> del payload del webhook
            directamente, sino contrastarlo siempre contra el monto persistido en
            nuestra propia base de datos. Stripe puede redondear internamente.
          </p>

          <PullQuote cite="Bitácora del proyecto · 2026-05-17">
            El reverse proxy normaliza los headers a minúsculas: validar la firma
            asumiendo capitalización exacta cuesta dos horas de debugging y un café frío.
          </PullQuote>

          <p>
            En el resto del módulo, cada nueva integración debe seguir el mismo patrón.
            La auditoría queda en el cerebro principal del proyecto, citable desde
            cualquier tarea futura por su id de memoria.
          </p>
        </article>

        <div className={styles.marginaliaWrap}>
          <Marginalia label="Decisión" variant="block">
            Aprobada el 17 de mayo de 2026 tras revisar el incidente STR-014.
          </Marginalia>
          <Marginalia label="Origen" variant="block">
            Memoria #M-3 · publicada por Manuel desde la tarea PROJ-2.
          </Marginalia>
        </div>
      </section>

      <RuleDivider variant="double" spacing="xl" />

      {/* Type scale referencia */}
      <section className={styles.section}>
        <Eyebrow ornament="reference">Tipografía</Eyebrow>
        <div className={styles.typeScale}>
          <p className={styles.t5}>Display · 80 / 0.95 — Fraunces WONK opsz 144</p>
          <p className={styles.t4}>Masthead · 56 / 1.0</p>
          <p className={styles.t3}>Section · 40 / 1.1</p>
          <p className={styles.t2}>H2 · 30 / 1.2</p>
          <p className={styles.t1}>H3 · 24 / 1.25</p>
          <p className={styles.tBody}>
            Body editorial · Newsreader · 17 / 1.7. Pensado para lectura larga de
            memorias técnicas. La itálica se reserva para citas y deck.
          </p>
          <p className={styles.tUi}>UI sans · IBM Plex Sans · 15 / 1.5.</p>
          <p className={styles.tMono}>
            <code>mono · JetBrains Mono · 14 / 1.5 · ad_pk_q2tOIkHL0OJp9_kK</code>
          </p>
        </div>
      </section>
    </div>
  );
}
