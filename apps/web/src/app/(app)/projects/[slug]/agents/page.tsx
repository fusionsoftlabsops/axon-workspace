import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getServerT } from '@/lib/i18n/server';
import { PageHeader, Eyebrow } from '@/components/ui';
import { listAgentsAction, listAgentRunsAction, getAgentStatsAction } from '@/lib/actions/agents';
import { AgentsClient } from './AgentsClient';
import styles from './agents.module.scss';

export default async function AgentsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user?.id) return null;
  const t = await getServerT();

  const project = await prisma.project.findUnique({
    where: { slug },
    include: { members: { where: { userId: session.user.id }, select: { role: true } } },
  });
  if (!project || project.members.length === 0) notFound();
  const role = project.members[0]!.role;
  const canManage = role === 'OWNER' || role === 'ADMIN';

  const [agents, runs, stats] = await Promise.all([
    listAgentsAction(slug),
    listAgentRunsAction(slug),
    getAgentStatsAction(slug),
  ]);

  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow={<Eyebrow>{t('Equipo agéntico', 'Agentic team')}</Eyebrow>}
        title={t('Agentes', 'Agents')}
        description={t(
          'El equipo de agentes que trabaja el tablero: actívalos por rol, define su modelo y presupuesto, y audita cada corrida.',
          'The agent team working the board: enable them per role, set their model and budget, and audit every run.',
        )}
      />
      <AgentsClient
        slug={slug}
        canManage={canManage}
        initialPreset={project.teamPreset ?? null}
        initialAgents={agents.ok ? (agents.data ?? []) : []}
        initialRuns={runs.ok ? (runs.data ?? []) : []}
        initialStats={stats.ok ? (stats.data ?? null) : null}
      />
    </main>
  );
}
