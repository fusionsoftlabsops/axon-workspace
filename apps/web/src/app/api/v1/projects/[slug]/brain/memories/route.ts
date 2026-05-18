import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import { audit } from '@/lib/audit';

const memoryTypeEnum = z.enum([
  'DECISION',
  'GOTCHA',
  'PATTERN',
  'ANTIPATTERN',
  'RUNBOOK',
  'GLOSSARY',
  'NOTE',
]);

const createBody = z.object({
  type: memoryTypeEnum,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
  tags: z.array(z.string().min(1).max(40)).max(8).default([]),
  scope: z.enum(['LOCAL', 'PROJECT']).default('LOCAL'),
  sourceTaskNumber: z.number().int().positive().optional(),
});

/**
 * GET — list memories the caller is allowed to see.
 * POST — create a memory by hand (default scope LOCAL).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const authd = await requireApiToken(req, ['brain:read']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }

  const project = await prisma.project.findUnique({
    where: { slug },
    select: { id: true, members: { where: { userId: authd.userId }, select: { role: true } } },
  });
  if (!project || project.members.length === 0) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }

  const isOwner = project.members[0]!.role === 'OWNER';
  const sp = req.nextUrl.searchParams;
  const scope = sp.get('scope') as 'LOCAL' | 'PROJECT' | null;

  const where: Prisma.BrainMemoryWhereInput = {
    projectId: project.id,
    status: 'ACTIVE',
    OR: [
      { scope: 'PROJECT' },
      isOwner
        ? { scope: 'LOCAL' }
        : { scope: 'LOCAL', ownerUserId: authd.userId },
    ],
  };
  if (scope) where.scope = scope;

  const memories = await prisma.brainMemory.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    include: {
      author: { select: { name: true } },
      sourceTask: { select: { taskNumber: true } },
    },
    take: 200,
  });

  return NextResponse.json({
    count: memories.length,
    memories: memories.map((m) => ({
      id: m.id,
      scope: m.scope,
      type: m.type,
      title: m.title,
      body: m.body,
      tags: m.tags,
      status: m.status,
      authorName: m.author.name,
      ownerUserId: m.ownerUserId,
      sourceTaskNumber: m.sourceTask?.taskNumber ?? null,
      citationCount: m.citationCount,
      lastCitedAt: m.lastCitedAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const authd = await requireApiToken(req, ['brain:write']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = createBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 });
  }
  const data = parsed.data;

  const project = await prisma.project.findUnique({
    where: { slug },
    select: { id: true, members: { where: { userId: authd.userId }, select: { role: true } } },
  });
  if (!project || project.members.length === 0) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }
  if (project.members[0]!.role === 'VIEWER') {
    return NextResponse.json({ error: 'viewer cannot create memories' }, { status: 403 });
  }

  let sourceTaskId: string | null = null;
  if (data.sourceTaskNumber) {
    const task = await prisma.task.findUnique({
      where: {
        projectId_taskNumber: { projectId: project.id, taskNumber: data.sourceTaskNumber },
      },
      select: { id: true },
    });
    if (!task) return NextResponse.json({ error: 'source task not found' }, { status: 404 });
    sourceTaskId = task.id;
  }

  const created = await prisma.brainMemory.create({
    data: {
      projectId: project.id,
      scope: data.scope,
      ownerUserId: data.scope === 'LOCAL' ? authd.userId : null,
      authorId: authd.userId,
      type: data.type,
      title: data.title,
      body: data.body,
      tags: data.tags,
      sourceTaskId,
    },
    select: { id: true },
  });

  await audit({
    actorId: authd.userId,
    action: 'brain.capture',
    resourceType: 'memory',
    resourceId: created.id,
    projectId: project.id,
    payload: { scope: data.scope, type: data.type, via: 'api' },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
