/**
 * GET /api/v1/projects
 *   → cartera del token: proyectos donde su usuario es miembro, con un rollup por
 *   proyecto (HUs abiertas, borradores del plan, agentes activos, corridas en
 *   vuelo, preset y ejecutor). El punto de arranque del supervisor multi-proyecto
 *   desde la consola. scope projects:read.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireApiToken } from '@/lib/api-auth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authd = await requireApiToken(req, ['projects:read']);
  if (authd instanceof NextResponse) return authd;

  // Proyectos donde el usuario del token es miembro (el token con projectSlugs
  // vacío alcanza todos ellos; uno con allowlist se filtra abajo).
  const memberships = await prisma.projectMember.findMany({
    where: { userId: authd.userId },
    select: {
      role: true,
      project: {
        select: { id: true, slug: true, name: true, teamPreset: true, devExecutor: true, agentRuntime: true, updatedAt: true },
      },
    },
    orderBy: { project: { updatedAt: 'desc' } },
  });

  const allow = authd.projectSlugs;
  const scoped = allow.length === 0 ? memberships : memberships.filter((m) => allow.includes(m.project.slug));
  if (scoped.length === 0) return NextResponse.json({ projects: [] });

  const ids = scoped.map((m) => m.project.id);

  // Agregados en lote (una query por métrica, agrupada por proyecto).
  const [openByProj, draftsByProj, agentsByProj, runningByProj] = await Promise.all([
    prisma.task.groupBy({
      by: ['projectId'],
      where: { projectId: { in: ids }, state: { category: { not: 'DONE' } } },
      _count: { _all: true },
    }),
    prisma.storyDraft.groupBy({
      by: ['projectId'],
      where: { projectId: { in: ids }, taskId: null },
      _count: { _all: true },
    }),
    prisma.agent.groupBy({
      by: ['projectId'],
      where: { projectId: { in: ids }, enabled: true },
      _count: { _all: true },
    }),
    prisma.agentRun.groupBy({
      by: ['agentId'],
      where: { status: 'RUNNING', agent: { projectId: { in: ids } } },
      _count: { _all: true },
    }),
  ]);

  const openMap = new Map(openByProj.map((r) => [r.projectId, r._count._all]));
  const draftMap = new Map(draftsByProj.map((r) => [r.projectId, r._count._all]));
  const agentMap = new Map(agentsByProj.map((r) => [r.projectId, r._count._all]));
  // runningByProj está agrupado por agentId → hay que mapear agentId→projectId.
  const runningAgents = runningByProj.map((r) => r.agentId);
  const agentProject = runningAgents.length
    ? await prisma.agent.findMany({ where: { id: { in: runningAgents } }, select: { id: true, projectId: true } })
    : [];
  const agentToProject = new Map(agentProject.map((a) => [a.id, a.projectId]));
  const runningMap = new Map<string, number>();
  for (const r of runningByProj) {
    const pid = agentToProject.get(r.agentId);
    if (pid) runningMap.set(pid, (runningMap.get(pid) ?? 0) + r._count._all);
  }

  const projects = scoped.map((m) => ({
    slug: m.project.slug,
    name: m.project.name,
    role: m.role,
    teamPreset: m.project.teamPreset,
    devExecutor: m.project.devExecutor,
    agentRuntime: m.project.agentRuntime,
    counts: {
      openTasks: openMap.get(m.project.id) ?? 0,
      drafts: draftMap.get(m.project.id) ?? 0,
      agentsEnabled: agentMap.get(m.project.id) ?? 0,
      runningRuns: runningMap.get(m.project.id) ?? 0,
    },
    updatedAt: m.project.updatedAt.toISOString(),
  }));

  return NextResponse.json({ projects });
}
