/**
 * POST /api/v1/projects/[slug]/agents/preset
 *   → provisiona un EQUIPO completo de una: un preset (ECO|BALANCED|MAX) o el
 *   equipo por defecto estilo-axon ('AXON_DEFAULT'). Guard OWNER/ADMIN.
 *   No devuelve tokens en claro: quedan sellados y el worker los obtiene vía
 *   /internal/agent-runtime.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import { audit } from '@/lib/audit';
import { applyTeamPreset, provisionDefaultTeam } from '@/lib/actions/agents';

export const runtime = 'nodejs';

const body = z.object({
  preset: z.enum(['ECO', 'BALANCED', 'MAX', 'AXON_DEFAULT']).default('AXON_DEFAULT'),
});

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
  const memberRole = project.members[0]!.role;
  if (memberRole !== 'OWNER' && memberRole !== 'ADMIN') {
    return NextResponse.json({ error: 'only project owners/admins can provision teams' }, { status: 403 });
  }

  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  const result =
    parsed.data.preset === 'AXON_DEFAULT'
      ? await provisionDefaultTeam(project.id, slug)
      : await applyTeamPreset(project.id, slug, parsed.data.preset);

  await audit({
    actorId: authd.userId,
    action: 'agent.provision',
    resourceType: 'project',
    resourceId: project.id,
    projectId: project.id,
    payload: { via: 'api-preset', preset: parsed.data.preset },
  });

  return NextResponse.json({ ok: true, preset: parsed.data.preset, ...result });
}
