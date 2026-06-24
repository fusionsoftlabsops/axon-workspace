import Link from 'next/link';
import { Eyebrow } from '@/components/ui';
import { getServerT } from '@/lib/i18n/server';
import styles from './page.module.scss';

export default async function HomePage() {
  const t = await getServerT();
  return (
    <main className={styles.main}>
      <div className={styles.hero}>
        <div className={styles.eyebrow}>
          <Eyebrow tone="muted">
            Axon
          </Eyebrow>
        </div>

        <h1 className={styles.title}>
          {t('La bitácora ', 'The ')}
          <span className={styles.titleAccent}>{t('técnica', 'technical')}</span>
          {t(' de tus proyectos', ' logbook for your projects')}
        </h1>

        <div aria-hidden className={styles.rule} />

        <p className={styles.tagline}>
          {t(
            'Kanban, vault E2E y un cerebro curado por proyecto. Diseñado para vivir junto a Claude Code, no encima.',
            'Kanban, an E2E vault, and a curated brain per project. Designed to live alongside Claude Code, not on top of it.',
          )}
        </p>

        <div className={styles.actions}>
          <Link href="/login" className={styles.primary}>
            {t('Iniciar sesión', 'Sign in')}
          </Link>
          <Link href="/signup" className={styles.secondary}>
            {t('Crear cuenta', 'Create account')}
          </Link>
        </div>

        <div className={styles.pillars}>
          <article className={styles.pillar} style={{ '--index': 0 } as React.CSSProperties}>
            <span className={styles.pillarNum}>I.</span>
            <h3>{t('Tareas Kanban', 'Kanban tasks')}</h3>
            <p>
              {t(
                'Jerarquía Epic → Tarea → Subtarea, workflows configurables y drag-and-drop con optimistic updates.',
                'Epic → Task → Subtask hierarchy, configurable workflows, and drag-and-drop with optimistic updates.',
              )}
            </p>
          </article>
          <article className={styles.pillar} style={{ '--index': 1 } as React.CSSProperties}>
            <span className={styles.pillarNum}>II.</span>
            <h3>{t('Vault zero-knowledge', 'Zero-knowledge vault')}</h3>
            <p>
              {t(
                'Credenciales encriptadas end-to-end. Compartición criptográfica por miembro, sin que el servidor las lea jamás.',
                'End-to-end encrypted credentials. Cryptographic per-member sharing, without the server ever reading them.',
              )}
            </p>
          </article>
          <article className={styles.pillar} style={{ '--index': 2 } as React.CSSProperties}>
            <span className={styles.pillarNum}>III.</span>
            <h3>{t('Cerebro + MCP', 'Brain + MCP')}</h3>
            <p>
              {t(
                'Conocimiento curado por proyecto que Claude Code consulta y enriquece a través de un MCP server en Docker.',
                'Curated per-project knowledge that Claude Code queries and enriches through an MCP server in Docker.',
              )}
            </p>
          </article>
        </div>
      </div>
    </main>
  );
}
