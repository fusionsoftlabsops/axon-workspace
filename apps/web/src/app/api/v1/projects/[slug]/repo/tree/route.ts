/**
 * GET /api/v1/projects/[slug]/repo/tree?root=apps/web&depth=2
 *   → árbol del repo asociado al proyecto, sandboxed por RepoReader.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSessionOrToken } from '@/lib/api-auth';
import { repoReaderFor } from '@/lib/repo/reader';
import { env } from '@/lib/env';
import { repoSlug, githubRepoTree, githubTreeNodes } from '@/lib/repo/github';

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

  const root = req.nextUrl.searchParams.get('root') ?? '.';
  const depthRaw = req.nextUrl.searchParams.get('depth');
  const depth = depthRaw ? Math.min(Math.max(parseInt(depthRaw, 10), 1), 6) : 2;

  const reader = await repoReaderFor({ repoPath: project.repoPath });
  if (reader) {
    try {
      const tree = await reader.tree({ root, maxDepth: depth });
      return NextResponse.json({ root, depth, tree, source: 'local' });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'tree failed' }, { status: 400 });
    }
  }

  // Fallback GitHub (caso de producción: repo solo remoto, sin clon local).
  const token = env().GITHUB_TOKEN;
  const repo = await prisma.projectRepo.findFirst({
    where: { projectId: project.id, OR: [{ url: { not: null } }, { githubFullName: { not: null } }] },
  });
  const full = repo ? repoSlug(repo) : null;
  if (full && token) {
    try {
      const entries = await githubRepoTree(full, repo!.defaultBranch ?? 'main', token);
      const tree = githubTreeNodes(entries, root, depth);
      return NextResponse.json({ root, depth, tree, source: 'github' });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'github tree failed' }, { status: 502 });
    }
  }

  return NextResponse.json({ error: 'repositorio no configurado o inaccesible' }, { status: 412 });
}
