import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';

/**
 * Resumen del grafo de código del proyecto (CodeAnalysis de graphify), en
 * solo-lectura: el mismo mapa que ancla la planeación brownfield, expuesto a
 * los agentes para fundamentar sus decisiones en el código real.
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

  const analysis = await prisma.codeAnalysis.findUnique({
    where: { projectId: project.id },
    select: { status: true, summary: true, godNodes: true, stats: true, backend: true, updatedAt: true },
  });
  if (!analysis || analysis.status !== 'READY') {
    return NextResponse.json({ status: analysis?.status ?? 'NONE', summary: null, godNodes: [], stats: null });
  }

  return NextResponse.json({
    status: 'READY',
    summary: analysis.summary,
    godNodes: analysis.godNodes ?? [],
    stats: analysis.stats ?? null,
    backend: analysis.backend,
    updatedAt: analysis.updatedAt.toISOString(),
  });
}
