import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import { searchBrain } from '@/lib/brain';

/**
 * GET /api/v1/projects/[slug]/brain/recall?q=...&limit=20
 *
 * Full-text search over the project's brain (PROJECT scope + own LOCAL).
 * Used by Claude Code via the MCP `recall` tool.
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
    select: {
      id: true,
      members: { where: { userId: authd.userId }, select: { role: true } },
    },
  });
  if (!project || project.members.length === 0) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }

  const q = req.nextUrl.searchParams.get('q')?.trim();
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10);

  const results = await searchBrain({
    projectId: project.id,
    requesterUserId: authd.userId,
    includeAllLocals: project.members[0]!.role === 'OWNER',
    query: q && q.length > 0 ? q : undefined,
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20,
  });

  return NextResponse.json({
    query: q ?? null,
    count: results.length,
    memories: results.map((m) => ({
      id: m.id,
      scope: m.scope,
      type: m.type,
      title: m.title,
      body: m.body,
      tags: m.tags,
      status: m.status,
      authorName: m.authorName,
      sourceTaskNumber: m.sourceTaskNumber,
      citationCount: m.citationCount,
      lastCitedAt: m.lastCitedAt?.toISOString() ?? null,
      updatedAt: m.updatedAt.toISOString(),
      rank: m.rank,
    })),
  });
}
