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
import { gitProviderFromEnv } from '@/lib/repo/provider';

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

  const provider = gitProviderFromEnv();
  const refOf = (r: { url: string | null; githubFullName: string | null }) =>
    provider.resolveRef(r.githubFullName ?? r.url ?? '');

  // Repo del PR: query ?repo=<name> para desambiguar; default el primero con ref.
  const repos = await prisma.projectRepo.findMany({ where: { projectId: project.id } });
  const repoName = req.nextUrl.searchParams.get('repo');
  const target = repoName ? repos.find((r) => r.name === repoName) : repos.find((r) => refOf(r));
  const ref = target ? refOf(target) : null;
  if (!ref) return NextResponse.json({ error: 'repo git no encontrado' }, { status: 404 });
  const full = `${ref.owner}/${ref.repo}`;

  try {
    const meta = await provider.getPrMeta({ repo: full, number: prNumber, token });
    const raw = await provider.getPrDiff({ repo: full, number: prNumber, token });
    const truncated = raw.length > MAX_DIFF_CHARS;
    return NextResponse.json({
      repo: target!.name,
      number: prNumber,
      title: meta.title,
      state: meta.state,
      merged: meta.merged,
      headRef: meta.headRef,
      additions: meta.additions,
      deletions: meta.deletions,
      changedFiles: meta.changedFiles,
      url: meta.url,
      truncated,
      diff: truncated ? `${raw.slice(0, MAX_DIFF_CHARS)}\n…(diff truncado)` : raw,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'git error' },
      { status: 502 },
    );
  }
}
