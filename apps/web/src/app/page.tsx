import Link from 'next/link';
import { Eyebrow } from '@/components/ui';
import styles from './page.module.scss';

export default function HomePage() {
  return (
    <main className={styles.main}>
      <div className={styles.hero}>
        <div className={styles.eyebrow}>
          <Eyebrow ornament="asterism" tone="muted">
            admin · data · project
          </Eyebrow>
        </div>

        <h1 className={styles.title}>
          La bitácora <span className={styles.titleAccent}>técnica</span> de tus proyectos
        </h1>

        <div aria-hidden className={styles.rule} />

        <p className={styles.tagline}>
          Kanban, vault E2E y un cerebro curado por proyecto. Diseñado para vivir junto a Claude
          Code, no encima.
        </p>

        <div className={styles.actions}>
          <Link href="/login" className={styles.primary}>
            § Iniciar sesión
          </Link>
          <Link href="/signup" className={styles.secondary}>
            ※ Crear cuenta
          </Link>
        </div>

        <div className={styles.pillars}>
          <article className={styles.pillar} style={{ '--index': 0 } as React.CSSProperties}>
            <span className={styles.pillarNum}>I.</span>
            <h3>Tareas Kanban</h3>
            <p>
              Jerarquía Epic → Tarea → Subtarea, workflows configurables y drag-and-drop con
              optimistic updates.
            </p>
          </article>
          <article className={styles.pillar} style={{ '--index': 1 } as React.CSSProperties}>
            <span className={styles.pillarNum}>II.</span>
            <h3>Vault zero-knowledge</h3>
            <p>
              Credenciales encriptadas end-to-end. Compartición criptográfica por miembro, sin
              que el servidor las lea jamás.
            </p>
          </article>
          <article className={styles.pillar} style={{ '--index': 2 } as React.CSSProperties}>
            <span className={styles.pillarNum}>III.</span>
            <h3>Cerebro + MCP</h3>
            <p>
              Conocimiento curado por proyecto que Claude Code consulta y enriquece a través de
              un MCP server en Docker.
            </p>
          </article>
        </div>
      </div>
    </main>
  );
}
