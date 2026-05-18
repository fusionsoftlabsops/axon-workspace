import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import { audit } from '@/lib/audit';

/**
 * POST /api/v1/projects/[slug]/brain/memories/[id]/publish
 *
 * Promote a LOCAL memory to the shared PROJECT brain. Auto-accept policy:
 * publishing is immediate (no review queue). Only the memory's owner or
 * an OWNER/ADMIN of the project may publish.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const authd = await requireApiToken(req, ['brain:write']);
  if (authd instanceof NextResponse) return authd;
  if (!tokenAllowsProject(authd, slug)) {
    return NextResponse.json({ error: 'token not scoped to this project' }, { status: 403 });
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
  if (memory.scope === 'PROJECT') {
    return NextResponse.json({ error: 'memory already published' }, { status: 400 });
  }

  const role = memory.project.members[0]!.role;
  const isOwner = memory.ownerUserId === authd.userId;
  if (!isOwner && role !== 'OWNER' && role !== 'ADMIN') {
    return NextResponse.json(
      { error: 'only the memory owner or project OWNER/ADMIN can publish' },
      { status: 403 },
    );
  }

  await prisma.brainMemory.update({
    where: { id },
    data: { scope: 'PROJECT', ownerUserId: null },
  });

  await audit({
    actorId: authd.userId,
    action: 'brain.publish',
    resourceType: 'memory',
    resourceId: id,
    projectId: memory.project.id,
    payload: { via: 'api' },
  });

  return NextResponse.json({ ok: true });
}
