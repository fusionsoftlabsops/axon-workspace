import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import { audit } from '@/lib/audit';

const body = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(20_000),
  reproSteps: z.string().max(20_000).optional(),
  stackTrace: z.string().max(50_000).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('HIGH'),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const authd = await requireApiToken(req, ['bugs:write']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 });
  }
  const data = parsed.data;

  const project = await prisma.project.findUnique({
    where: { slug },
    select: {
      id: true,
      members: { where: { userId: authd.userId }, select: { role: true } },
      workflows: {
        where: { isDefault: true },
        include: { states: { orderBy: { order: 'asc' } } },
      },
    },
  });
  if (!project || project.members.length === 0) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }
  const role = project.members[0]!.role;
  if (role === 'VIEWER') {
    return NextResponse.json({ error: 'viewer cannot create bugs' }, { status: 403 });
  }

  const firstState = project.workflows[0]?.states[0];
  if (!firstState) {
    return NextResponse.json({ error: 'project has no workflow' }, { status: 500 });
  }

  const description = [
    `### Resumen`,
    data.description,
    data.reproSteps ? `\n### Pasos para reproducir\n${data.reproSteps}` : '',
    data.stackTrace ? `\n### Stack trace\n\`\`\`\n${data.stackTrace}\n\`\`\`` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const created = await prisma.$transaction(async (tx) => {
    const counter = await tx.projectTaskCounter.update({
      where: { projectId: project.id },
      data: { next: { increment: 1 } },
    });
    const taskNumber = counter.next - 1;

    const task = await tx.task.create({
      data: {
        projectId: project.id,
        taskNumber,
        stateId: firstState.id,
        title: `🐛 ${data.title}`,
        description,
        priority: data.priority,
        reporterId: authd.userId,
        assigneeId: authd.userId,
      },
    });
    await tx.taskActivity.create({
      data: { taskId: task.id, actorId: authd.userId, type: 'CREATED', payload: { type: 'bug' } },
    });
    return task;
  });

  await audit({
    actorId: authd.userId,
    action: 'task.create',
    resourceType: 'bug',
    resourceId: created.id,
    projectId: project.id,
    payload: { via: 'api', tokenId: authd.tokenId },
  });

  return NextResponse.json(
    { id: created.id, number: created.taskNumber, title: created.title },
    { status: 201 },
  );
}
