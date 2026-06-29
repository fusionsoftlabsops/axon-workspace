import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getServerT } from '@/lib/i18n/server';
import { PageHeader, Eyebrow } from '@/components/ui';
import { getOrCreatePlanAction } from '@/lib/actions/planning';
import { PlanChat } from './PlanChat';
import styles from './plan.module.scss';

export default async function PlanPage({ params }: { params: Promise<{ slug: string }> }) {
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

  const res = await getOrCreatePlanAction(slug);
  // The project's uploaded files, so the user can mark which feed the plan
  // straight from the chat view (no trip to the Files tab).
  const contextFiles = (
    await prisma.projectFile.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, category: true, isContext: true },
    })
  ).map((f) => ({ id: f.id, name: f.name, category: f.category, isContext: f.isContext }));

  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow={<Eyebrow>{t('Planeación asistida por IA', 'AI-assisted planning')}</Eyebrow>}
        title={t('Plan del proyecto', 'Project plan')}
        description={t(
          'Conversa con la IA para afinar la idea; luego genera sprints y tareas, y publícalos al tablero.',
          'Chat with the AI to sharpen the idea; then generate sprints and tasks and publish them to the board.',
        )}
      />
      {res.ok && res.data ? (
        <PlanChat
          slug={slug}
          canWrite={role !== 'VIEWER'}
          initialPlan={res.data}
          contextFiles={contextFiles}
        />
      ) : (
        <p className={styles.error}>{res.ok ? t('No se pudo cargar el plan', 'Could not load the plan') : res.error}</p>
      )}
    </main>
  );
}
