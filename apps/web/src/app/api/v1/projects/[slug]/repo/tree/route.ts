/**
 * GET /api/v1/projects/[slug]/repo/tree?root=apps/web&depth=2
 *   → árbol del repo asociado al proyecto, sandboxed por RepoReader.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSessionOrToken } from '@/lib/api-auth';
import { repoReaderFor } from '@/lib/repo/reader';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const authd = await requireSessionOrToken(req, ['repo:read']);
  if (authd instanceof NextResponse) return authd;

  const project = await prisma.project.findUnique({
    where: { slug },
    select: {
      id: true,
      repoPath: true,
      members: { where: { userId: authd.userId }, select: { role: true } },
    },
  });
  if (!project || project.members.length === 0) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }

  const reader = await repoReaderFor({ repoPath: project.repoPath });
  if (!reader) {
    return NextResponse.json(
      { error: 'repositorio no configurado o inaccesible' },
      { status: 412 },
    );
  }

  const root = req.nextUrl.searchParams.get('root') ?? '.';
  const depthRaw = req.nextUrl.searchParams.get('depth');
  const depth = depthRaw ? Math.min(Math.max(parseInt(depthRaw, 10), 1), 6) : 2;

  try {
    const tree = await reader.tree({ root, maxDepth: depth });
    return NextResponse.json({ root, depth, tree });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'tree failed' },
      { status: 400 },
    );
  }
}
