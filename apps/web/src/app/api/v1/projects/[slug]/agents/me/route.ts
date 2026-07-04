import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';

/**
 * Config del agente que llama, resuelta por identidad de token. Es lo primero
 * que hace el worker al reaccionar a un evento: saber si SU rol está enabled,
 * con qué modelo corre y con qué presupuesto (corte duro por corrida).
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

  const project = await prisma.project.findUnique({ where: { slug }, select: { id: true, devExecutor: true } });
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 });

  const agent = await prisma.agent.findFirst({
    where: { projectId: project.id, userId: authd.userId },
    select: {
      id: true,
      role: true,
      userId: true,
      displayName: true,
      llmModel: true,
      credentialRef: true,
      tokenBudget: true,
      enabled: true,
    },
  });
  if (!agent) {
    return NextResponse.json({ error: 'caller is not an agent of this project' }, { status: 404 });
  }
  // devExecutor viaja con el perfil: el SM enruta la asignación según el modo.
  return NextResponse.json({ ...agent, devExecutor: project.devExecutor });
}
