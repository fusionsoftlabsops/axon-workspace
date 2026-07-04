/**
 * GET /api/v1/projects/[slug]/prs/[number]/diff
 *   → diff completo del PR (truncado) + metadatos. El objeto central de la
 *   AUDITORÍA de código del supervisor: revisar exactamente qué cambió el
 *   agente. Server-side con GITHUB_TOKEN (Accept: application/vnd.github.diff).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import { env } from '@/lib/env';
import { GITHUB_API, githubJson, githubText, repoSlug } from '@/lib/repo/github';

export const runtime = 'nodejs';

const MAX_DIFF_CHARS = 120_000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; number: string }> },
) {
  const { slug, number } = await params;
  const prNumber = parseInt(number, 10);
  if (!Number.isFinite(prNumber) || prNumber < 1) {
    return NextResponse.json({ error: 'invalid PR number' }, { status: 400 });
  }
  const authd = await requireApiToken(req, ['tasks:read']);
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

  const token = env().GITHUB_TOKEN;
  if (!token) return NextResponse.json({ error: 'GITHUB_TOKEN no configurado' }, { status: 501 });

  // Repo del PR: query ?repo=<name> para desambiguar; default el primero con slug.
  const repos = await prisma.projectRepo.findMany({ where: { projectId: project.id } });
  const repoName = req.nextUrl.searchParams.get('repo');
  const target = repoName ? repos.find((r) => r.name === repoName) : repos.find((r) => repoSlug(r));
  const full = target ? repoSlug(target) : null;
  if (!full) return NextResponse.json({ error: 'repo de GitHub no encontrado' }, { status: 404 });

  try {
    const meta = (await githubJson(`${GITHUB_API}/repos/${full}/pulls/${prNumber}`, token)) as {
      title?: string;
      state?: string;
      merged_at?: string | null;
      additions?: number;
      deletions?: number;
      changed_files?: number;
      head?: { ref?: string };
      html_url?: string;
    };
    const raw = await githubText(
      `${GITHUB_API}/repos/${full}/pulls/${prNumber}`,
      token,
      'application/vnd.github.diff',
    );
    const truncated = raw.length > MAX_DIFF_CHARS;
    return NextResponse.json({
      repo: target!.name,
      number: prNumber,
      title: meta.title ?? '',
      state: meta.state ?? '',
      merged: !!meta.merged_at,
      headRef: meta.head?.ref ?? '',
      additions: meta.additions ?? 0,
      deletions: meta.deletions ?? 0,
      changedFiles: meta.changed_files ?? 0,
      url: meta.html_url ?? '',
      truncated,
      diff: truncated ? `${raw.slice(0, MAX_DIFF_CHARS)}\n…(diff truncado)` : raw,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'github error' },
      { status: 502 },
    );
  }
}
