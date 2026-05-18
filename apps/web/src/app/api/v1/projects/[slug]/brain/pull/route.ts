import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import { pullProjectBrain } from '@/lib/brain';
import { audit } from '@/lib/audit';

/**
 * GET /api/v1/projects/[slug]/brain/pull
 *
 * Incremental pull of the project (shared) brain since the requester's last
 * pull. Updates BrainSyncState.lastPulledAt server-side.
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
    select: { id: true, members: { where: { userId: authd.userId }, select: { id: true } } },
  });
  if (!project || project.members.length === 0) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }

  const result = await pullProjectBrain({
    userId: authd.userId,
    projectId: project.id,
    projectSlug: slug,
  });

  await audit({
    actorId: authd.userId,
    action: 'brain.pull',
    resourceType: 'project',
    resourceId: project.id,
    projectId: project.id,
    payload: { count: result.count, since: result.lastPulledAt, via: 'api' },
  });

  return NextResponse.json(result);
}
