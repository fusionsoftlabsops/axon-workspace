import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import { audit } from '@/lib/audit';
import { linkProjectRepo } from '@/lib/repo/link';

/**
 * Repos vinculados al proyecto (solo lectura): el agente Dev los usa para
 * saber QUÉ clonar. La URL es la pública del repo — el token de clone lo
 * aporta el worker por env (nunca viaja por esta API).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const authd = await requireApiToken(req, ['projects:read']);
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

  const repos = await prisma.projectRepo.findMany({
    where: { projectId: project.id },
    select: { name: true, kind: true, url: true, githubFullName: true, defaultBranch: true },
    orderBy: { name: 'asc' },
  });

  return NextResponse.json({
    repos: repos.map((r) => ({
      name: r.name,
      kind: r.kind,
      url: r.url,
      githubFullName: r.githubFullName,
      defaultBranch: r.defaultBranch ?? 'main',
    })),
  });
}

const postBody = z.object({
  name: z.string().min(1).max(100),
  url: z.string().min(1).max(300),
  kind: z.string().max(40).optional(),
});

/**
 * Vincula un repo GitHub existente al proyecto (name + url [+ kind]) — mismo
 * núcleo que la UI. Para el supervisor/interventor de consola. Guard: miembro
 * no-VIEWER del proyecto.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const authd = await requireApiToken(req, ['tasks:write']);
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
  if (project.members[0]!.role === 'VIEWER') {
    return NextResponse.json({ error: 'viewer cannot link repos' }, { status: 403 });
  }

  const parsed = postBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  let repo;
  try {
    repo = await linkProjectRepo(project.id, parsed.data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'link failed' }, { status: 400 });
  }
  await audit({
    actorId: authd.userId,
    action: 'project.update',
    resourceType: 'project',
    resourceId: project.id,
    projectId: project.id,
    payload: { via: 'api', repoLinked: repo.githubFullName ?? repo.url },
  });
  return NextResponse.json({ ok: true, repo }, { status: 201 });
}
