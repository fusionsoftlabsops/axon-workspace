/**
 * GET /api/v1/projects/[slug]/prs?state=open|closed|all
 *   → PRs de los repos GitHub vinculados al proyecto. La superficie que usa el
 *   SUPERVISOR de consola para auditar el código que producen los agentes
 *   (ramas agent/hu-N → storyNumber). Server-side con GITHUB_TOKEN.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import { env } from '@/lib/env';
import { GITHUB_API, githubJson, repoSlug } from '@/lib/repo/github';

export const runtime = 'nodejs';

interface GhPr {
  number: number;
  title: string;
  state: string;
  merged_at: string | null;
  html_url: string;
  created_at: string;
  user?: { login?: string };
  head?: { ref?: string };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
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

  const repos = await prisma.projectRepo.findMany({ where: { projectId: project.id } });
  const slugs = repos
    .map((r) => ({ name: r.name, full: repoSlug(r) }))
    .filter((r): r is { name: string; full: string } => !!r.full);
  if (slugs.length === 0) {
    return NextResponse.json({ error: 'el proyecto no tiene repos de GitHub vinculados' }, { status: 404 });
  }

  const stateParam = req.nextUrl.searchParams.get('state') ?? 'open';
  const state = ['open', 'closed', 'all'].includes(stateParam) ? stateParam : 'open';

  const prs: Array<Record<string, unknown>> = [];
  for (const r of slugs) {
    try {
      const list = (await githubJson(
        `${GITHUB_API}/repos/${r.full}/pulls?state=${state}&per_page=50&sort=updated&direction=desc`,
        token,
      )) as GhPr[];
      for (const pr of list) {
        const headRef = pr.head?.ref ?? '';
        const m = headRef.match(/^agent\/hu-(\d+)$/);
        prs.push({
          repo: r.name,
          number: pr.number,
          title: pr.title,
          state: pr.state,
          merged: !!pr.merged_at,
          headRef,
          storyNumber: m ? parseInt(m[1]!, 10) : null,
          author: pr.user?.login ?? null,
          url: pr.html_url,
          createdAt: pr.created_at,
        });
      }
    } catch (err) {
      prs.push({ repo: r.name, error: err instanceof Error ? err.message : 'github error' });
    }
  }

  return NextResponse.json({ state, prs });
}
