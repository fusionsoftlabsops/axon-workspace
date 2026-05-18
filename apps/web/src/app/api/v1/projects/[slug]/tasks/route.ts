import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import { audit } from '@/lib/audit';

async function loadProject(slug: string, userId: string) {
  return prisma.project.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      members: { where: { userId }, select: { role: true } },
      workflows: {
        where: { isDefault: true },
        include: { states: { orderBy: { order: 'asc' } } },
      },
    },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const authd = await requireApiToken(req, ['tasks:read']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }

  const project = await loadProject(slug, authd.userId);
  if (!project || project.members.length === 0) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }

  const tasks = await prisma.task.findMany({
    where: { projectId: project.id },
    include: {
      state: { select: { name: true, category: true } },
      assignee: { select: { id: true, name: true } },
    },
    orderBy: { taskNumber: 'desc' },
  });

  return NextResponse.json({
    tasks: tasks.map((t) => ({
      id: t.id,
      number: t.taskNumber,
      title: t.title,
      state: t.state.name,
      stateCategory: t.state.category,
      priority: t.priority,
      assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
      dueDate: t.dueDate?.toISOString() ?? null,
    })),
  });
}

const createBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(20_000).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  parentTaskNumber: z.number().int().positive().optional(),
  stateName: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const authd = await requireApiToken(req, ['tasks:write']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }

  const project = await loadProject(slug, authd.userId);
  if (!project || project.members.length === 0) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }
  const role = project.members[0]!.role;
  if (role === 'VIEWER') {
    return NextResponse.json({ error: 'viewer cannot create tasks' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = createBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 });
  }
  const data = parsed.data;

  const workflow = project.workflows[0];
  if (!workflow) {
    return NextResponse.json({ error: 'project has no default workflow' }, { status: 500 });
  }
  const stateMatch = data.stateName
    ? workflow.states.find((s) => s.name.toLowerCase() === data.stateName!.toLowerCase())
    : workflow.states[0];
  if (!stateMatch) {
    return NextResponse.json({ error: `state "${data.stateName}" not found` }, { status: 400 });
  }

  let parentTaskId: string | undefined;
  if (data.parentTaskNumber) {
    const parent = await prisma.task.findUnique({
      where: { projectId_taskNumber: { projectId: project.id, taskNumber: data.parentTaskNumber } },
      select: { id: true },
    });
    if (!parent) {
      return NextResponse.json({ error: `parent task #${data.parentTaskNumber} not found` }, { status: 400 });
    }
    parentTaskId = parent.id;
  }

  const created = await prisma.$transaction(async (tx) => {
    const counter = await tx.projectTaskCounter.update({
      where: { projectId: project.id },
      data: { next: { increment: 1 } },
    });
    const taskNumber = counter.next - 1;
    const maxPos = await tx.task.aggregate({
      where: { projectId: project.id, stateId: stateMatch.id },
      _max: { positionInState: true },
    });

    const task = await tx.task.create({
      data: {
        projectId: project.id,
        taskNumber,
        parentTaskId,
        stateId: stateMatch.id,
        title: data.title,
        description: data.description,
        priority: data.priority,
        reporterId: authd.userId,
        assigneeId: authd.userId,
        positionInState: (maxPos._max.positionInState ?? -1) + 1,
      },
    });

    await tx.taskActivity.create({
      data: { taskId: task.id, actorId: authd.userId, type: 'CREATED' },
    });
    return task;
  });

  await audit({
    actorId: authd.userId,
    action: 'task.create',
    resourceType: 'task',
    resourceId: created.id,
    projectId: project.id,
    payload: { via: 'api', tokenId: authd.tokenId },
  });

  return NextResponse.json({
    id: created.id,
    number: created.taskNumber,
    project: slug,
    title: created.title,
    state: stateMatch.name,
  }, { status: 201 });
}
