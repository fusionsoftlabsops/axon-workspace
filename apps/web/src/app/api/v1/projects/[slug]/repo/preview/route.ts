/**
 * GET /api/v1/projects/[slug]/repo/preview?path=foo/bar.ts&start=10&end=80
 *   → contenido de un archivo (slice opcional por rango de líneas).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSessionOrToken } from '@/lib/api-auth';
import { repoReaderFor } from '@/lib/repo/reader';
import { env } from '@/lib/env';
import { repoSlug, githubFileContent } from '@/lib/repo/github';

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

  const p = req.nextUrl.searchParams.get('path');
  if (!p) return NextResponse.json({ error: 'missing path' }, { status: 400 });

  const startRaw = req.nextUrl.searchParams.get('start');
  const endRaw = req.nextUrl.searchParams.get('end');
  const start = startRaw ? Math.max(1, parseInt(startRaw, 10)) : null;
  const end = endRaw ? Math.max(1, parseInt(endRaw, 10)) : null;

  const slice = (content: string) => {
    if (start === null && end === null) return content;
    const lines = content.split('\n');
    const s = Math.max(0, (start ?? 1) - 1);
    const e = Math.min(lines.length, end ?? lines.length);
    return lines.slice(s, e).join('\n');
  };
  const range = start !== null || end !== null ? { start: start ?? 1, end: end ?? null } : null;

  const reader = await repoReaderFor({ repoPath: project.repoPath });
  if (!reader) {
    // Fallback GitHub (repo solo remoto).
    const token = env().GITHUB_TOKEN;
    const repo = await prisma.projectRepo.findFirst({
      where: { projectId: project.id, OR: [{ url: { not: null } }, { githubFullName: { not: null } }] },
    });
    const full = repo ? repoSlug(repo) : null;
    if (!full || !token) {
      return NextResponse.json({ error: 'repositorio no configurado o inaccesible' }, { status: 412 });
    }
    try {
      const f = await githubFileContent(full, repo!.defaultBranch ?? 'main', p, token);
      return NextResponse.json({
        path: p,
        language: undefined,
        truncated: f.truncated,
        bytes: f.bytes,
        content: slice(f.content),
        range,
        source: 'github',
      });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'github file failed' }, { status: 502 });
    }
  }

  try {
    const r = await reader.readFiles([p], { maxBytesTotal: 200_000 });
    const file = r.files[0];
    if (!file) return NextResponse.json({ error: 'archivo no encontrado o ignorado' }, { status: 404 });

    return NextResponse.json({
      path: file.path,
      language: file.language,
      truncated: file.truncated,
      bytes: file.bytes,
      content: slice(file.content),
      range,
      source: 'local',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'preview failed' },
      { status: 400 },
    );
  }
}
