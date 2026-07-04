/**
 * Registry MULTI-TENANT: obtiene los equipos de TODOS los proyectos desde
 * /internal/agent-runtime (con AGENT_RUNTIME_TOKEN), construye los handlers de
 * cada proyecto y los publica en el router. Refresca en intervalo para tomar
 * proyectos/agentes nuevos (auto-provisión) sin reiniciar.
 */
import type { AgentsConfig } from '../config.js';
import type { EventRouter, AgentRoleName } from '../router.js';
import { buildProjectTeam, type RuntimeProject, type RuntimeAgent } from '../bootstrap.js';

interface RuntimeResponse {
  projects: Array<{
    projectId: string;
    slug: string;
    agents: Array<{ role: string; enabled: boolean; llmModel: string; tokenBudget?: number; token: string }>;
  }>;
}

const ROLE_SET: ReadonlySet<string> = new Set([
  'SM', 'PO', 'ARCHITECT', 'DESIGN', 'DEV', 'QA', 'REVIEWER', 'MARKETING', 'RELEASE',
]);

async function fetchRuntime(config: AgentsConfig): Promise<RuntimeProject[]> {
  const url = `${config.AXON_API_BASE_URL}/internal/agent-runtime`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${config.AGENT_RUNTIME_TOKEN}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`agent-runtime ${res.status}`);
  const body = (await res.json()) as RuntimeResponse;
  return (body.projects ?? []).map((p) => ({
    projectId: p.projectId,
    projectSlug: p.slug,
    agents: (p.agents ?? [])
      .filter((a) => ROLE_SET.has(a.role))
      .map(
        (a): RuntimeAgent => ({
          role: a.role as AgentRoleName,
          token: a.token,
          llmModel: a.llmModel,
          enabled: a.enabled,
          tokenBudget: a.tokenBudget,
        }),
      ),
  }));
}

export interface RuntimeRegistry {
  /** Recarga los equipos y republica el router. Devuelve un resumen. */
  refresh(): Promise<{ projects: number; handlers: number; summary: string[] }>;
  /** Corre el sweep de estancadas de TODOS los proyectos. */
  sweepAll(): Promise<number>;
}

export function createRuntimeRegistry(config: AgentsConfig, router: EventRouter): RuntimeRegistry {
  let sweeps: Array<{ sweepOnce(): Promise<number> }> = [];

  async function refresh() {
    const projects = await fetchRuntime(config);
    const allHandlers = [];
    const nextSweeps: Array<{ sweepOnce(): Promise<number> }> = [];
    const summary: string[] = [];
    for (const p of projects) {
      const team = buildProjectTeam(config, p);
      allHandlers.push(...team.handlers);
      if (team.staleSweep) nextSweeps.push(team.staleSweep);
      summary.push(`${p.projectSlug}:[${team.registered.join(',') || '-'}]`);
    }
    router.replaceAll(allHandlers);
    sweeps = nextSweeps;
    return { projects: projects.length, handlers: allHandlers.length, summary };
  }

  async function sweepAll(): Promise<number> {
    let total = 0;
    for (const s of sweeps) {
      try {
        total += await s.sweepOnce();
      } catch (e) {
        console.error('[agents] stale sweep:', e instanceof Error ? e.message : e);
      }
    }
    return total;
  }

  return { refresh, sweepAll };
}
