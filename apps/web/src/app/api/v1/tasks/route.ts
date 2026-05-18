import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  const authd = await requireApiToken(req, ['tasks:read']);
  if (authd instanceof NextResponse) return authd;

  const sp = req.nextUrl.searchParams;
  const projectSlug = sp.get('project') ?? undefined;
  const assignedToMe = sp.get('assignedToMe') === 'true';
  const stateName = sp.get('state') ?? undefined;

  if (projectSlug && !tokenAllowsProject(authd, projectSlug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }

  const projectFilter = projectSlug
    ? { slug: projectSlug }
    : authd.projectSlugs.length > 0
      ? { slug: { in: authd.projectSlugs } }
      : undefined;

  const tasks = await prisma.task.findMany({
    where: {
      project: {
        ...projectFilter,
        members: { some: { userId: authd.userId } },
      },
      ...(assignedToMe ? { assigneeId: authd.userId } : {}),
      ...(stateName ? { state: { name: stateName } } : {}),
    },
    include: {
      project: { select: { slug: true, name: true } },
      state: { select: { name: true, category: true } },
      assignee: { select: { id: true, name: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });

  return NextResponse.json({
    tasks: tasks.map((t) => ({
      id: t.id,
      number: t.taskNumber,
      project: t.project.slug,
      title: t.title,
      state: t.state.name,
      stateCategory: t.state.category,
      priority: t.priority,
      assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
      dueDate: t.dueDate?.toISOString() ?? null,
      updatedAt: t.updatedAt.toISOString(),
    })),
  });
}
