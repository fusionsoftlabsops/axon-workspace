import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import type { AgentRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireApiToken, tokenAllowsProject } from '@/lib/api-auth';
import { audit } from '@/lib/audit';
import { provisionAgent } from '@/lib/agents/provision';

const ROLES = ['SM', 'PO', 'ARCHITECT', 'DESIGN', 'DEV', 'QA', 'REVIEWER', 'MARKETING', 'RELEASE'] as const;

const postBody = z.object({
  role: z.enum(ROLES),
  llmModel: z.string().min(1).max(100).default('claude-sonnet-5'),
  tokenBudget: z.number().int().min(1000).max(5_000_000).optional(),
  /** Activarlo de una (equivale a Aprovisionar + Activar en la UI). */
  enable: z.boolean().default(false),
});

/**
 * Aprovisiona el agente de un rol vía API (misma lógica que la pestaña Agentes)
 * y devuelve el token UNA sola vez en la respuesta. Permite automatizar el alta
 * del equipo sin pasar por el navegador.
 *
 * Guardarraíl: solo miembros OWNER/ADMIN del proyecto (los agentes son MEMBER →
 * un agente no puede acuñar agentes).
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
  const memberRole = project.members[0]!.role;
  if (memberRole !== 'OWNER' && memberRole !== 'ADMIN') {
    return NextResponse.json({ error: 'only project owners/admins can provision agents' }, { status: 403 });
  }

  const parsed = postBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;

  let provisioned;
  try {
    provisioned = await provisionAgent({
      projectId: project.id,
      projectSlug: slug,
      role: body.role as AgentRole,
      llmModel: body.llmModel,
      tokenBudget: body.tokenBudget,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'provision failed' },
      { status: 409 },
    );
  }

  if (body.enable) {
    await prisma.agent.update({ where: { id: provisioned.agentId }, data: { enabled: true } });
  }

  await audit({
    actorId: authd.userId,
    action: 'agent.provision',
    resourceType: 'agent',
    resourceId: provisioned.agentId,
    projectId: project.id,
    payload: { via: 'api', role: body.role, enabled: body.enable },
  });

  // El token viaja UNA sola vez (igual que en la UI); solo el hash queda en DB.
  return NextResponse.json(
    { ok: true, agentId: provisioned.agentId, role: body.role, enabled: body.enable, token: provisioned.tokenPlain },
    { status: 201 },
  );
}
