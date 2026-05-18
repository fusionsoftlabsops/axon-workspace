import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
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

const patchBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    body: z.string().min(1).max(20_000).optional(),
    type: memoryTypeEnum.optional(),
    tags: z.array(z.string().min(1).max(40)).max(8).optional(),
    status: z.enum(['ACTIVE', 'DEPRECATED']).optional(), // SUPERSEDED is internal-only
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'at least one field is required',
  });

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const authd = await requireApiToken(req, ['brain:read']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }

  const memory = await prisma.brainMemory.findUnique({
    where: { id },
    include: {
      author: { select: { name: true } },
      ownerUser: { select: { id: true, name: true } },
      sourceTask: { select: { taskNumber: true } },
      supersededBy: { select: { id: true, title: true } },
      supersedes: { select: { id: true, title: true } },
      citations: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          citedInTask: { select: { taskNumber: true, title: true } },
          citedByUser: { select: { name: true } },
        },
      },
      project: { select: { slug: true, members: { where: { userId: authd.userId } } } },
    },
  });
  if (!memory || memory.project.slug !== slug || memory.project.members.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // LOCAL scope visibility: only owner or project OWNER.
  if (memory.scope === 'LOCAL' && memory.ownerUserId !== authd.userId) {
    const role = memory.project.members[0]!.role;
    if (role !== 'OWNER') {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
  }

  return NextResponse.json({
    id: memory.id,
    scope: memory.scope,
    type: memory.type,
    title: memory.title,
    body: memory.body,
    tags: memory.tags,
    status: memory.status,
    authorName: memory.author.name,
    owner: memory.ownerUser ? { id: memory.ownerUser.id, name: memory.ownerUser.name } : null,
    sourceTaskNumber: memory.sourceTask?.taskNumber ?? null,
    supersededBy: memory.supersededBy,
    supersedes: memory.supersedes,
    citationCount: memory.citationCount,
    lastCitedAt: memory.lastCitedAt?.toISOString() ?? null,
    citations: memory.citations.map((c) => ({
      taskNumber: c.citedInTask.taskNumber,
      taskTitle: c.citedInTask.title,
      citedByName: c.citedByUser.name,
      context: c.context,
      createdAt: c.createdAt.toISOString(),
    })),
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const authd = await requireApiToken(req, ['brain:write']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = patchBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  const memory = await prisma.brainMemory.findUnique({
    where: { id },
    include: {
      project: {
        select: { id: true, slug: true, members: { where: { userId: authd.userId } } },
      },
    },
  });
  if (!memory || memory.project.slug !== slug || memory.project.members.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const role = memory.project.members[0]!.role;
  const isOwner = memory.ownerUserId === authd.userId || memory.authorId === authd.userId;
  if (!isOwner && role !== 'OWNER' && role !== 'ADMIN') {
    return NextResponse.json(
      { error: 'only the author or project OWNER/ADMIN can edit' },
      { status: 403 },
    );
  }

  await prisma.brainMemory.update({ where: { id }, data: parsed.data });

  await audit({
    actorId: authd.userId,
    action: parsed.data.status === 'DEPRECATED' ? 'brain.deprecate' : 'brain.capture',
    resourceType: 'memory',
    resourceId: id,
    projectId: memory.project.id,
    payload: { changes: Object.keys(parsed.data), via: 'api' },
  });

  return NextResponse.json({ ok: true });
}
