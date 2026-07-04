import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import { audit } from '@/lib/audit';
import { publishDomainEvent } from '@/lib/agents/events';
import { selfApprovalBlockReason } from '@/lib/agents/provision';

async function loadTaskByNumber(slug: string, taskNumber: number, userId: string) {
  const project = await prisma.project.findUnique({
    where: { slug },
    select: {
      id: true,
      members: { where: { userId }, select: { role: true } },
      workflows: {
        where: { isDefault: true },
        include: { states: { orderBy: { order: 'asc' } } },
      },
    },
  });
  if (!project || project.members.length === 0) return null;
  const task = await prisma.task.findUnique({
    where: { projectId_taskNumber: { projectId: project.id, taskNumber } },
    include: {
      state: { select: { id: true, name: true, category: true } },
      assignee: { select: { id: true, name: true } },
      reporter: { select: { id: true, name: true } },
      comments: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true } } },
      },
      subtasks: {
        select: { id: true, taskNumber: true, title: true, state: { select: { name: true } } },
      },
    },
  });
  if (!task) return null;
  return { project, task };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; taskNumber: string }> },
) {
  const { slug, taskNumber } = await params;
  const num = parseInt(taskNumber, 10);
  if (!Number.isFinite(num) || num < 1) {
    return NextResponse.json({ error: 'invalid taskNumber' }, { status: 400 });
  }

  const authd = await requireApiToken(req, ['tasks:read']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }

  const found = await loadTaskByNumber(slug, num, authd.userId);
  if (!found) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const { task } = found;

  return NextResponse.json({
    id: task.id,
    number: task.taskNumber,
    project: slug,
    title: task.title,
    description: task.description ?? '',
    state: task.state.name,
    priority: task.priority,
    assignee: task.assignee,
    reporter: task.reporter,
    dueDate: task.dueDate?.toISOString() ?? null,
    acceptanceCriteria: task.acceptanceCriteria ?? '',
    category: task.category ?? null,
    implPlan: task.implPlan ?? null,
    implPlanAt: task.implPlanAt?.toISOString() ?? null,
    designSpec: task.designSpec ?? null,
    designSpecAt: task.designSpecAt?.toISOString() ?? null,
    subtasks: task.subtasks.map((s) => ({
      number: s.taskNumber,
      title: s.title,
      state: s.state.name,
    })),
    comments: task.comments.map((c) => ({
      author: c.author.name,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    })),
  });
}

const patchBody = z
  .object({
    toState: z.string().optional(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(20_000).optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    // Asignar la HU al AGENTE de un rol del proyecto (el server resuelve su
    // userId — el llamador no necesita conocer identidades internas).
    assignToAgentRole: z.enum(['SM', 'DEV', 'QA', 'PO', 'DESIGN']).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'at least one field is required',
  });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; taskNumber: string }> },
) {
  const { slug, taskNumber } = await params;
  const num = parseInt(taskNumber, 10);
  if (!Number.isFinite(num) || num < 1) {
    return NextResponse.json({ error: 'invalid taskNumber' }, { status: 400 });
  }

  const authd = await requireApiToken(req, ['tasks:write']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }

  const found = await loadTaskByNumber(slug, num, authd.userId);
  if (!found) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const { project, task } = found;
  const role = project.members[0]!.role;
  if (role === 'VIEWER') {
    return NextResponse.json({ error: 'viewer cannot modify tasks' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = patchBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;

  let newStateId: string | undefined;
  let newState: { id: string; name: string; category: string } | undefined;
  let enteringDone = false;
  if (body.toState) {
    const stateMatch = project.workflows[0]?.states.find(
      (s) => s.name.toLowerCase() === body.toState!.toLowerCase(),
    );
    if (!stateMatch) {
      return NextResponse.json({ error: `state "${body.toState}" not found` }, { status: 400 });
    }
    newStateId = stateMatch.id;
    newState = { id: stateMatch.id, name: stateMatch.name, category: stateMatch.category };
    enteringDone = stateMatch.category === 'DONE' && stateMatch.id !== task.state.id;

    // Guardarraíl de plataforma: un agente no aprueba su propio trabajo.
    if (enteringDone) {
      const blocked = await selfApprovalBlockReason({
        projectId: project.id,
        actorUserId: authd.userId,
        qaHandoff: task.qaHandoff,
        assigneeId: task.assignee?.id ?? null,
      });
      if (blocked) {
        await audit({
          actorId: authd.userId,
          action: 'task.self_approval_blocked',
          resourceType: 'task',
          resourceId: task.id,
          projectId: project.id,
          payload: { via: 'api', reason: blocked },
        });
        return NextResponse.json({ error: blocked }, { status: 403 });
      }
    }
  }

  // Resolver el agente destino cuando se pide asignación por rol.
  let assigneeId: string | undefined;
  if (body.assignToAgentRole) {
    const targetAgent = await prisma.agent.findUnique({
      where: { projectId_role: { projectId: project.id, role: body.assignToAgentRole } },
      select: { userId: true, enabled: true },
    });
    if (!targetAgent) {
      return NextResponse.json(
        { error: `project has no ${body.assignToAgentRole} agent` },
        { status: 400 },
      );
    }
    if (!targetAgent.enabled) {
      return NextResponse.json(
        { error: `${body.assignToAgentRole} agent is disabled` },
        { status: 409 },
      );
    }
    assigneeId = targetAgent.userId;
  }

  await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: task.id },
      data: {
        ...(newStateId ? { stateId: newStateId } : {}),
        ...(body.title ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.priority ? { priority: body.priority } : {}),
        ...(assigneeId ? { assigneeId } : {}),
      },
    });
    if (newStateId && newStateId !== task.state.id) {
      await tx.taskActivity.create({
        data: {
          taskId: task.id,
          actorId: authd.userId,
          type: 'STATE_CHANGED',
          payload: { from: task.state.id, to: newStateId, via: 'api' },
        },
      });
    }
    if (assigneeId && assigneeId !== task.assignee?.id) {
      await tx.taskActivity.create({
        data: {
          taskId: task.id,
          actorId: authd.userId,
          type: 'ASSIGNED',
          payload: { to: assigneeId, agentRole: body.assignToAgentRole, via: 'api' },
        },
      });
    }
  });

  if (newState && newState.id !== task.state.id) {
    publishDomainEvent({
      type: 'story.state_changed',
      projectId: project.id,
      storyId: task.id,
      storyNumber: task.taskNumber,
      fromState: { id: task.state.id, name: task.state.name, category: task.state.category },
      toState: newState,
      actorId: authd.userId,
      assigneeId: assigneeId ?? task.assignee?.id ?? null,
    });
  }

  // Same hook as moveTaskAction: when a task enters a DONE category, fire the
  // brain extractor for the actor's local brain.
  if (enteringDone) {
    const { extractMemoriesFromTaskAction } = await import('@/lib/actions/brain');
    void extractMemoriesFromTaskAction(slug, task.id, authd.userId).catch((err) => {
      console.error('[brain] post-close extraction failed (api):', err);
    });
  }

  await audit({
    actorId: authd.userId,
    action: 'task.update',
    resourceType: 'task',
    resourceId: task.id,
    projectId: project.id,
    payload: { via: 'api', changes: Object.keys(body) },
  });

  return NextResponse.json({ ok: true });
}
