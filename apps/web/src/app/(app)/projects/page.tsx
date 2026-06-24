import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { Eyebrow } from '@/components/ui';
import { NewProjectForm } from './NewProjectForm';
import styles from './page.module.scss';
import { getServerT } from '@/lib/i18n/server';

export default async function ProjectsPage() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const t = await getServerT();

  const projects = await prisma.project.findMany({
    where: { members: { some: { userId: session.user.id } } },
    include: {
      _count: { select: { tasks: true, members: true } },
      members: {
        where: { userId: session.user.id },
        select: { role: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  const issueNumber = String(projects.length + 1).padStart(3, '0');
  const year = new Date().getFullYear();

  // Bilingual label + accent for each non-active lifecycle status.
  const statusBadge: Record<string, { label: string; color: string }> = {
    PAUSED: { label: t('Pausado', 'Paused'), color: '#b45309' },
    INACTIVE: { label: t('Desactivado', 'Inactive'), color: 'var(--color-fg-muted)' },
    COMPLETED: { label: t('Completado', 'Completed'), color: '#15803d' },
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div>
            <div className={styles.eyebrow}>
              <Eyebrow ornament="reference" tone="muted">
                {t('Catálogo · Vol.', 'Catalog · Vol.')} {year}
              </Eyebrow>
            </div>
            <h1 className={styles.title}>{t('Proyectos', 'Projects')}</h1>
            <p className={styles.deck}>
              {t(
                'Cada proyecto es una edición con su propio tablero, vault y cerebro. Pasa página entre ellos cuando cambies de cliente o de iniciativa.',
                'Each project is an edition with its own board, vault and brain. Turn the page between them when you switch client or initiative.',
              )}
            </p>
          </div>
        </div>
        <div aria-hidden className={styles.rule} />
      </header>

      <div className={styles.grid}>
        {projects.map((p, idx) => (
          <Link
            key={p.id}
            href={`/projects/${p.slug}/board`}
            className={styles.card}
            style={{ '--index': idx } as React.CSSProperties}
          >
            <div className={styles.cardEyebrow}>
              <Eyebrow tone="muted">
                № {String(idx + 1).padStart(3, '0')}
              </Eyebrow>
            </div>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>{p.name}</h2>
              <span className={styles.role}>{p.members[0]?.role}</span>
            </div>
            {statusBadge[p.status] && (
              <span
                style={{
                  alignSelf: 'flex-start',
                  padding: '0.15rem 0.55rem',
                  borderRadius: '999px',
                  border: `1px solid ${statusBadge[p.status]!.color}`,
                  color: statusBadge[p.status]!.color,
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {statusBadge[p.status]!.label}
              </span>
            )}
            {p.description && <p className={styles.desc}>{p.description}</p>}
            <div className={styles.meta}>
              <span>
                <span className={styles.metaNum}>{p._count.tasks}</span> {t('tareas', 'tasks')}
              </span>
              <span>
                <span className={styles.metaNum}>{p._count.members}</span>{' '}
                {p._count.members === 1 ? t('miembro', 'member') : t('miembros', 'members')}
              </span>
              <code>{p.slug}</code>
            </div>
          </Link>
        ))}

        <div className={styles.newCard}>
          <h3>№ {issueNumber} · {t('Nueva edición', 'New edition')}</h3>
          <NewProjectForm />
        </div>
      </div>
    </div>
  );
}
