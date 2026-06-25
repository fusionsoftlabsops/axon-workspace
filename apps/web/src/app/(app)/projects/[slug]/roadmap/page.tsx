import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getServerT } from '@/lib/i18n/server';
import { PageHeader, Eyebrow, Badge } from '@/components/ui';
import { PLAN_CATEGORIES, type PlanCategory } from '@/lib/ai/plan-schema';
import styles from './roadmap.module.scss';

const LANE_COLOR: Record<PlanCategory, string> = {
  infra: '#6366f1',
  backend: '#3b82f6',
  frontend: '#10b981',
  design: '#ec4899',
  qa: '#f59e0b',
  devops: '#8b5cf6',
  docs: '#64748b',
  other: '#94a3b8',
};

export default async function RoadmapPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user?.id) return null;
  const t = await getServerT();

  const project = await prisma.project.findUnique({
    where: { slug },
    include: {
      members: { where: { userId: session.user.id }, select: { role: true } },
      sprints: {
        orderBy: { order: 'asc' },
        include: {
          tasks: {
            orderBy: { positionInState: 'asc' },
            select: {
              id: true,
              taskNumber: true,
              title: true,
              category: true,
              estimate: true,
              priority: true,
              recommendedRoles: true,
            },
          },
        },
      },
    },
  });
  if (!project || project.members.length === 0) notFound();

  const plan = await prisma.projectPlan.findFirst({
    where: { projectId: project.id },
    orderBy: { createdAt: 'desc' },
    select: { suggestedRepos: true },
  });
  const repos = (plan?.suggestedRepos as { name: string; kind: string; stack?: string; reason?: string }[] | null) ?? [];

  const sprints = project.sprints;
  const allTasks = sprints.flatMap((s) => s.tasks);
  const lanes = PLAN_CATEGORIES.filter((c) => allTasks.some((tk) => (tk.category ?? 'other') === c));

  const catLabel = (c: PlanCategory): string =>
    ({
      infra: t('Infra', 'Infra'),
      backend: t('Backend', 'Backend'),
      frontend: t('Frontend', 'Frontend'),
      design: t('Diseño', 'Design'),
      qa: 'QA',
      devops: 'DevOps',
      docs: t('Docs', 'Docs'),
      other: t('Otros', 'Other'),
    })[c];

  const header = (
    <PageHeader
      eyebrow={<Eyebrow>{t('Hoja de ruta', 'Roadmap')}</Eyebrow>}
      title={t('Roadmap del producto', 'Product roadmap')}
      description={t(
        'Tareas por categoría (filas) a lo largo de los sprints (columnas).',
        'Tasks by category (rows) across the sprints (columns).',
      )}
    />
  );

  if (sprints.length === 0 || allTasks.length === 0) {
    return (
      <main className={styles.page}>
        {header}
        <div className={styles.empty}>
          {t('Aún no hay un plan publicado.', 'No published plan yet.')}{' '}
          <Link href={`/projects/${slug}/plan`}>{t('Ir a planeación', 'Go to planning')}</Link>
        </div>
      </main>
    );
  }

  const gridCols = `minmax(150px,180px) repeat(${sprints.length}, minmax(240px,1fr))`;

  return (
    <main className={styles.page}>
      {header}
      <div className={styles.scroll}>
        <div className={styles.grid} style={{ gridTemplateColumns: gridCols }}>
          {/* Header row */}
          <div className={`${styles.corner} ${styles.colHead}`} />
          {sprints.map((s) => (
            <div key={s.id} className={styles.colHead}>
              {s.name}
              {s.goal && <span className={styles.colHeadGoal}>{s.goal}</span>}
            </div>
          ))}

          {/* One row per category lane */}
          {lanes.map((lane) => (
            <RoadmapLane
              key={lane}
              label={catLabel(lane)}
              color={LANE_COLOR[lane]}
              cells={sprints.map((s) => s.tasks.filter((tk) => (tk.category ?? 'other') === lane))}
            />
          ))}
        </div>
      </div>

      {repos.length > 0 && (
        <>
          <h3 style={{ marginTop: '2rem' }}>{t('Repositorios sugeridos', 'Suggested repositories')}</h3>
          <div className={styles.repos}>
            {repos.map((r, i) => (
              <div key={i} className={styles.repoCard}>
                <div className={styles.repoName}>
                  {r.name} <Badge tone="neutral">{r.kind}</Badge>
                </div>
                {r.stack && <p className={styles.repoReason}>{r.stack}</p>}
                {r.reason && <p className={styles.repoReason}>{r.reason}</p>}
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function RoadmapLane({
  label,
  color,
  cells,
}: {
  label: string;
  color: string;
  cells: {
    id: string;
    taskNumber: number;
    title: string;
    category: string | null;
    estimate: string | null;
    priority: string;
    recommendedRoles: string[];
  }[][];
}) {
  return (
    <>
      <div className={styles.laneLabel}>
        <span className={styles.laneDot} style={{ background: color }} aria-hidden />
        {label}
      </div>
      {cells.map((tasks, i) => (
        <div key={i} className={styles.cell}>
          {tasks.map((tk) => (
            <div key={tk.id} className={styles.card} style={{ '--lane': color } as React.CSSProperties}>
              <div className={styles.cardNum}>#{tk.taskNumber}</div>
              <p className={styles.cardTitle}>{tk.title}</p>
              <div className={styles.cardMeta}>
                {tk.estimate && <span>{tk.estimate}</span>}
                <span>{tk.priority}</span>
                {tk.recommendedRoles.length > 0 && <span>· {tk.recommendedRoles.join(', ')}</span>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
