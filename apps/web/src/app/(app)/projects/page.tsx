import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { Eyebrow } from '@/components/ui';
import { NewProjectForm } from './NewProjectForm';
import styles from './page.module.scss';

export default async function ProjectsPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

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

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div>
            <div className={styles.eyebrow}>
              <Eyebrow ornament="reference" tone="muted">
                Catálogo · Vol. {year}
              </Eyebrow>
            </div>
            <h1 className={styles.title}>Proyectos</h1>
            <p className={styles.deck}>
              Cada proyecto es una edición con su propio tablero, vault y cerebro. Pasa página
              entre ellos cuando cambies de cliente o de iniciativa.
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
            {p.description && <p className={styles.desc}>{p.description}</p>}
            <div className={styles.meta}>
              <span>
                <span className={styles.metaNum}>{p._count.tasks}</span> tareas
              </span>
              <span>
                <span className={styles.metaNum}>{p._count.members}</span>{' '}
                {p._count.members === 1 ? 'miembro' : 'miembros'}
              </span>
              <code>{p.slug}</code>
            </div>
          </Link>
        ))}

        <div className={styles.newCard}>
          <h3>№ {issueNumber} · Nueva edición</h3>
          <NewProjectForm />
        </div>
      </div>
    </div>
  );
}
