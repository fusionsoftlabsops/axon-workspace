/**
 * Cableado del equipo. `buildProjectTeam` construye los handlers de UN proyecto
 * a partir de sus agentes de runtime (token + modelo por agente); es la unidad
 * que el registry MULTI-TENANT llama por cada proyecto.
 *
 * Cada rol se activa solo si tiene lo que necesita (agente habilitado + provider
 * LLM cuando aplica); lo que falte se reporta en `skipped`.
 *
 * Modelo por agente (axon#…): los roles que usan el LLM del worker (SM-retro,
 * DEV-strong, QA, REVIEWER) reciben un provider construido con EL MODELO de su
 * fila (`llmModel`), no un modelo global — así ECO/BALANCED/MAX difieren de
 * verdad. Los roles advisory (PO/ARCHITECT/DESIGN/MARKETING/RELEASE) disparan
 * generación server-side en axon-web, que ya respeta su modelo.
 */
import type { RoleHandler, AgentRoleName } from './router.js';
import { AxonApi } from './api/client.js';
import type { GitProviderConfig, GitProviderKind } from './git/provider.js';
import type { ProvidersConfig } from './runtime/providers/resolve.js';
import { resolveAnthropicProvider, resolveDevProviders } from './runtime/providers/resolve.js';
import { createSmAssignHandler } from './roles/sm.js';
import { createSmRetroHandler } from './roles/sm-retro.js';
import { createPoHandler } from './roles/po.js';
import { createDesignHandler } from './roles/design.js';
import { createReviewerHandler } from './roles/reviewer.js';
import { createArchitectHandler } from './roles/architect.js';
import { createMarketingHandler } from './roles/marketing.js';
import { createReleaseHandler } from './roles/release.js';
import { createSmStaleSweep } from './roles/sm-stale.js';
import { createDevHandler } from './roles/dev.js';
import { createQaHandler } from './roles/qa.js';

/** Un agente tal como lo entrega /internal/agent-runtime. */
export interface RuntimeAgent {
  role: AgentRoleName;
  token: string;
  llmModel: string;
  enabled: boolean;
}

export interface RuntimeProject {
  projectId: string;
  projectSlug: string;
  agents: RuntimeAgent[];
}

export interface ProjectTeam {
  projectId: string;
  projectSlug: string;
  handlers: RoleHandler[];
  staleSweep: { sweepOnce(): Promise<number> } | null;
  registered: string[];
  skipped: Array<{ role: string; reason: string }>;
}

/**
 * Vista angosta de la config que `buildProjectTeam` realmente usa (ISP): así el
 * caller pasa su `AgentsConfig` completo (lo satisface estructuralmente) sin que
 * el bootstrap dependa del objeto entero. Extiende `ProvidersConfig` (la parte
 * de selección de provider) con lo específico del cableado del equipo.
 */
export interface TeamDeps extends ProvidersConfig {
  AXON_API_BASE_URL: string;
  GITHUB_TOKEN?: string;
  GIT_PROVIDER?: GitProviderKind;
  GIT_API_BASE_URL?: string;
  GIT_HOST?: string;
  DEV_MAX_ITERATIONS: number;
  AGENT_MAX_DURATION_MS: number;
}

/** Config del proveedor git derivada de `deps` (default GitHub). */
function gitConfigOf(deps: TeamDeps): GitProviderConfig {
  return {
    provider: deps.GIT_PROVIDER ?? 'github',
    apiBaseUrl: deps.GIT_API_BASE_URL ?? 'https://api.github.com',
    host: deps.GIT_HOST ?? 'github.com',
  };
}

/** Props comunes a todo handler advisory (RELEASE agrega `gitToken`/`gitConfig`). */
interface AdvisoryProps {
  api: AxonApi;
  projectId: string;
  projectSlug: string;
  gitToken?: string;
  gitConfig?: GitProviderConfig;
}

/**
 * Tabla declarativa de los roles advisory (sin provider LLM): comparten el
 * patrón "hay agente habilitado → push del handler con {api, projectId,
 * projectSlug}; si no → skipped". RELEASE agrega `gitToken` (`needsGitToken`).
 */
interface AdvisoryEntry {
  role: AgentRoleName;
  create: (props: AdvisoryProps) => RoleHandler;
  needsGitToken?: boolean;
}

// PO/ARCHITECT/MARKETING/DESIGN corren tras el SM (medio del pipeline).
const ADVISORY_CORE: AdvisoryEntry[] = [
  { role: 'PO', create: createPoHandler },
  { role: 'ARCHITECT', create: createArchitectHandler },
  { role: 'MARKETING', create: createMarketingHandler },
  { role: 'DESIGN', create: createDesignHandler },
];
// RELEASE cierra el pipeline (tras REVIEWER) — de ahí que vaya aparte.
const ADVISORY_RELEASE: AdvisoryEntry = { role: 'RELEASE', create: createReleaseHandler, needsGitToken: true };

/** Construye los handlers de UN proyecto (no los registra; el caller decide). */
export function buildProjectTeam(deps: TeamDeps, project: RuntimeProject): ProjectTeam {
  const handlers: RoleHandler[] = [];
  const registered: string[] = [];
  const skipped: Array<{ role: string; reason: string }> = [];
  let staleSweep: ProjectTeam['staleSweep'] = null;

  const { projectId, projectSlug } = project;
  const gitConfig = gitConfigOf(deps);
  const byRole = new Map<AgentRoleName, RuntimeAgent>();
  for (const a of project.agents) if (a.enabled) byRole.set(a.role, a);

  const api = (a: RuntimeAgent) => new AxonApi(deps.AXON_API_BASE_URL, a.token);
  const poEnabled = byRole.has('PO');
  const designEnabled = byRole.has('DESIGN');

  // Registra un rol advisory según la tabla (o lo reporta ausente).
  const registerAdvisory = (entry: AdvisoryEntry) => {
    const agent = byRole.get(entry.role);
    if (!agent) {
      skipped.push({ role: entry.role, reason: 'agente ausente/apagado' });
      return;
    }
    handlers.push(
      entry.create({
        api: api(agent),
        projectId,
        projectSlug,
        ...(entry.needsGitToken ? { gitToken: deps.GITHUB_TOKEN, gitConfig } : {}),
      }),
    );
    registered.push(entry.role);
  };

  // ---- SM ----
  const sm = byRole.get('SM');
  if (sm) {
    handlers.push(createSmAssignHandler({ api: api(sm), projectId, projectSlug, poEnabled, designEnabled }));
    registered.push('SM:assign');
    const smProvider = resolveAnthropicProvider(deps, sm.llmModel);
    if (smProvider) {
      handlers.push(createSmRetroHandler({ api: api(sm), projectId, projectSlug, provider: smProvider }));
      registered.push('SM:retro');
    } else {
      skipped.push({ role: 'SM:retro', reason: 'sin ANTHROPIC_API_KEY' });
    }
    staleSweep = createSmStaleSweep({ api: api(sm), projectId, projectSlug, provider: smProvider ?? undefined });
    registered.push('SM:stale-sweep');
  } else {
    skipped.push({ role: 'SM', reason: 'agente ausente/apagado' });
  }

  // ---- PO / ARCHITECT / MARKETING / DESIGN (advisory, sin provider) ----
  for (const entry of ADVISORY_CORE) registerAdvisory(entry);

  // ---- DEV (Qwen primario + strong Claude para UI/complejas) ----
  const dev = byRole.get('DEV');
  if (!dev) {
    skipped.push({ role: 'DEV', reason: 'agente ausente/apagado' });
  } else {
    const providers = resolveDevProviders(deps, dev.llmModel);
    if (!providers) {
      skipped.push({ role: 'DEV', reason: 'sin FUSION_MODEL_URL / FUSION_TOKEN' });
    } else {
      handlers.push(
        createDevHandler({
          api: api(dev),
          projectId,
          projectSlug,
          provider: providers.qwen,
          strongProvider: providers.strongProvider,
          gitToken: deps.GITHUB_TOKEN,
          gitConfig,
          maxIterations: deps.DEV_MAX_ITERATIONS,
          maxDurationMs: deps.AGENT_MAX_DURATION_MS,
        }),
      );
      registered.push(providers.strongProvider ? 'DEV(+strong)' : 'DEV');
    }
  }

  // ---- QA (Claude, modelo del agente) ----
  const qa = byRole.get('QA');
  if (!qa) {
    skipped.push({ role: 'QA', reason: 'agente ausente/apagado' });
  } else {
    const provider = resolveAnthropicProvider(deps, qa.llmModel);
    if (!provider) {
      skipped.push({ role: 'QA', reason: 'sin ANTHROPIC_API_KEY' });
    } else {
      handlers.push(
        createQaHandler({
          api: api(qa),
          projectId,
          projectSlug,
          provider,
          gitToken: deps.GITHUB_TOKEN,
          gitConfig,
          maxDurationMs: deps.AGENT_MAX_DURATION_MS,
        }),
      );
      registered.push('QA');
    }
  }

  // ---- REVIEWER (Ren, code review, modelo del agente) ----
  const rev = byRole.get('REVIEWER');
  if (!rev) {
    skipped.push({ role: 'REVIEWER', reason: 'agente ausente/apagado' });
  } else {
    const provider = resolveAnthropicProvider(deps, rev.llmModel);
    if (!provider) {
      skipped.push({ role: 'REVIEWER', reason: 'sin ANTHROPIC_API_KEY' });
    } else {
      handlers.push(
        createReviewerHandler({
          api: api(rev),
          projectId,
          projectSlug,
          provider,
          gitToken: deps.GITHUB_TOKEN,
          gitConfig,
          maxDurationMs: deps.AGENT_MAX_DURATION_MS,
        }),
      );
      registered.push('REVIEWER');
    }
  }

  // ---- RELEASE (Marco: verifica readiness del PR en DONE, advisory) ----
  registerAdvisory(ADVISORY_RELEASE);

  return { projectId, projectSlug, handlers, staleSweep, registered, skipped };
}
