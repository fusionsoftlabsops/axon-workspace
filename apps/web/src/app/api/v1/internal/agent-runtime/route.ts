/**
 * GET /api/v1/internal/agent-runtime
 *   → alimenta al WORKER MULTI-TENANT: por cada proyecto, los agentes con su
 *   token DESELLADO (plaintext) para que el worker pueda actuar como cada uno.
 *
 * Superficie PRIVILEGIADA: requiere el scope exclusivo `agents:runtime`, que
 * solo porta el token de servicio del worker (AGENT_RUNTIME_TOKEN) — nunca un
 * agente ni un usuario. Ese token puede actuar como CUALQUIER agente de
 * CUALQUIER proyecto; vive solo en el env del worker, sobre red interna.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireApiToken } from '@/lib/api-auth';
import { openAgentToken } from '@/lib/agents/runtime-tokens';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authd = await requireApiToken(req, ['agents:runtime']);
  if (authd instanceof NextResponse) return authd;

  // Todos los tokens de runtime + el estado (enabled/llmModel) de su Agent.
  const rows = await prisma.agentRuntimeToken.findMany({
    include: {
      project: { select: { id: true, slug: true } },
    },
  });
  if (rows.length === 0) return NextResponse.json({ projects: [] });

  // Estado por (projectId, role) desde Agent (enabled + llmModel).
  const agents = await prisma.agent.findMany({
    select: { projectId: true, role: true, enabled: true, llmModel: true, tokenBudget: true },
  });
  const agentMap = new Map(agents.map((a) => [`${a.projectId}:${a.role}`, a]));

  const byProject = new Map<
    string,
    { projectId: string; slug: string; agents: Array<Record<string, unknown>> }
  >();
  for (const row of rows) {
    const meta = agentMap.get(`${row.projectId}:${row.role}`);
    if (!meta) continue; // token huérfano (agent borrado): ignorar
    let token: string;
    try {
      token = openAgentToken(row);
    } catch {
      continue; // no se pudo desellar (clave rotada, etc.): saltar
    }
    const entry = byProject.get(row.projectId) ?? {
      projectId: row.projectId,
      slug: row.project.slug,
      agents: [],
    };
    entry.agents.push({
      role: row.role,
      enabled: meta.enabled,
      llmModel: meta.llmModel,
      tokenBudget: meta.tokenBudget,
      token,
    });
    byProject.set(row.projectId, entry);
  }

  return NextResponse.json({ projects: [...byProject.values()] });
}
