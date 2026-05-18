import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { BoardClient } from './BoardClient';
import styles from './board.module.scss';

export default async function BoardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user?.id) return null;

  const project = await prisma.project.findUnique({
    where: { slug },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
      workflows: {
        where: { isDefault: true },
        include: { states: { orderBy: { order: 'asc' } } },
      },
      tasks: {
        where: { parentTaskId: null },
        orderBy: [{ stateId: 'asc' }, { positionInState: 'asc' }],
        include: {
          assignee: { select: { id: true, name: true } },
          _count: { select: { subtasks: true, comments: true } },
        },
      },
    },
  });

  if (!project || project.members.every((m) => m.userId !== session.user.id)) {
    notFound();
  }

  const workflow = project.workflows[0];
  if (!workflow) {
    return (
      <div style={{ padding: '2rem' }}>
        <p>Este proyecto no tiene workflow configurado.</p>
      </div>
    );
  }

  const myRole = project.members.find((m) => m.userId === session.user.id)!.role;

  // Count local-brain memories created in the last 30 days that the user
  // could still publish. The banner nudges them to review captures from
  // recently-closed tasks before they go stale in their head.
  const thirtyDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30);
  const pendingMemoryCount = await prisma.brainMemory.count({
    where: {
      projectId: project.id,
      scope: 'LOCAL',
      status: 'ACTIVE',
      ownerUserId: session.user.id,
      createdAt: { gte: thirtyDaysAgo },
    },
  });

  return (
    <>
      {pendingMemoryCount > 0 && (
        <Link
          href={`/projects/${slug}/brain?tab=local`}
          className={styles.banner}
        >
          <span className={styles.bannerIcon}>🧠</span>
          <span>
            Tienes <strong>{pendingMemoryCount}</strong>{' '}
            {pendingMemoryCount === 1 ? 'memoria local' : 'memorias locales'} de los últimos 30 días.{' '}
            Revísalas y publica las útiles al cerebro del proyecto.
          </span>
          <span className={styles.bannerCta}>Ir al cerebro →</span>
        </Link>
      )}
      <BoardClient
      projectSlug={slug}
      canWrite={myRole !== 'VIEWER'}
      currentUserId={session.user.id}
      members={project.members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
      }))}
      states={workflow.states.map((s) => ({
        id: s.id,
        name: s.name,
        color: s.color,
        category: s.category,
        order: s.order,
      }))}
      tasks={project.tasks.map((t) => ({
        id: t.id,
        taskNumber: t.taskNumber,
        title: t.title,
        stateId: t.stateId,
        priority: t.priority,
        assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
        positionInState: t.positionInState,
        subtaskCount: t._count.subtasks,
        commentCount: t._count.comments,
        dueDate: t.dueDate?.toISOString() ?? null,
      }))}
      />
    </>
  );
}
