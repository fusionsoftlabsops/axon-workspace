import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getServerT } from '@/lib/i18n/server';
import { PageHeader, Eyebrow } from '@/components/ui';
import { listTeamChatAction } from '@/lib/actions/team-chat';
import { TeamChatClient } from './TeamChatClient';
import styles from './team.module.scss';

export default async function TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user?.id) return null;
  const t = await getServerT();

  const project = await prisma.project.findUnique({
    where: { slug },
    include: { members: { where: { userId: session.user.id }, select: { role: true } } },
  });
  if (!project || project.members.length === 0) notFound();
  const canWrite = project.members[0]!.role !== 'VIEWER';

  const messages = await listTeamChatAction(slug, 150);

  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow={<Eyebrow>{t('Equipo agéntico', 'Agentic team')}</Eyebrow>}
        title={t('Equipo', 'Team')}
        description={t(
          'El standup permanente: cada agente narra su turno (tomó una HU, terminó, entrega al siguiente) y vos podés intervenir en el hilo.',
          'The permanent standup: each agent narrates its turn (picked a story, finished, hands off) and you can jump into the thread.',
        )}
      />
      <TeamChatClient
        slug={slug}
        canWrite={canWrite}
        initialMessages={messages.ok ? (messages.data ?? []) : []}
      />
    </main>
  );
}
