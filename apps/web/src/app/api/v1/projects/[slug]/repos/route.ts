import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';

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
