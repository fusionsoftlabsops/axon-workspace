/**
 * Cableado del equipo. `buildProjectTeam` construye los handlers de UN proyecto
 * a partir de sus agentes de runtime (token + modelo por agente); es la unidad
 * que usa tanto el modo LEGACY single-project (`buildTeam`, tokens por env) como
 * el modo MULTI-TENANT (el registry lo llama por cada proyecto).
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
import type { AgentsConfig } from './config.js';
import { EventRouter, type RoleHandler, type AgentRoleName } from './router.js';
import { AxonApi } from './api/client.js';
import { createOpenAiProvider } from './runtime/providers/openai.js';
import { createAnthropicProvider } from './runtime/providers/anthropic.js';
import type { LlmProvider } from './runtime/types.js';
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

/** Un agente tal como lo entrega /internal/agent-runtime (o el env legacy). */
export interface RuntimeAgent {
  role: AgentRoleName;
  token: string;
  llmModel: string;
  enabled: boolean;
  tokenBudget?: number;
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

export interface TeamWiring {
  registered: string[];
  skipped: Array<{ role: string; reason: string }>;
  staleSweep: { sweepOnce(): Promise<number> } | null;
}

/** Provider Anthropic para un agente, usando SU modelo (si es claude-*) o el default. */
function anthropicFor(config: AgentsConfig, llmModel: string): LlmProvider | null {
  if (!config.ANTHROPIC_API_KEY) return null;
  const model = llmModel.startsWith('claude-') ? llmModel : config.ANTHROPIC_MODEL;
  return createAnthropicProvider({ apiKey: config.ANTHROPIC_API_KEY, model });
}

/** Construye los handlers de UN proyecto (no los registra; el caller decide). */
export function buildProjectTeam(config: AgentsConfig, project: RuntimeProject): ProjectTeam {
  const handlers: RoleHandler[] = [];
  const registered: string[] = [];
  const skipped: Array<{ role: string; reason: string }> = [];
  let staleSweep: ProjectTeam['staleSweep'] = null;

  const { projectId, projectSlug } = project;
  const byRole = new Map<AgentRoleName, RuntimeAgent>();
  for (const a of project.agents) if (a.enabled) byRole.set(a.role, a);

  const api = (a: RuntimeAgent) => new AxonApi(config.AXON_API_BASE_URL, a.token);
  const poEnabled = byRole.has('PO');
  const designEnabled = byRole.has('DESIGN');

  // ---- SM ----
  const sm = byRole.get('SM');
  if (sm) {
    handlers.push(createSmAssignHandler({ api: api(sm), projectId, projectSlug, poEnabled, designEnabled }));
    registered.push('SM:assign');
    const smProvider = anthropicFor(config, sm.llmModel);
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
  const po = byRole.get('PO');
  if (po) {
    handlers.push(createPoHandler({ api: api(po), projectId, projectSlug }));
    registered.push('PO');
  } else {
    skipped.push({ role: 'PO', reason: 'agente ausente/apagado' });
  }
  const arch = byRole.get('ARCHITECT');
  if (arch) {
    handlers.push(createArchitectHandler({ api: api(arch), projectId, projectSlug }));
    registered.push('ARCHITECT');
  } else {
    skipped.push({ role: 'ARCHITECT', reason: 'agente ausente/apagado' });
  }
  const mkt = byRole.get('MARKETING');
  if (mkt) {
    handlers.push(createMarketingHandler({ api: api(mkt), projectId, projectSlug }));
    registered.push('MARKETING');
  } else {
    skipped.push({ role: 'MARKETING', reason: 'agente ausente/apagado' });
  }
  const design = byRole.get('DESIGN');
  if (design) {
    handlers.push(createDesignHandler({ api: api(design), projectId, projectSlug }));
    registered.push('DESIGN');
  } else {
    skipped.push({ role: 'DESIGN', reason: 'agente ausente/apagado' });
  }

  // ---- DEV (Qwen primario + strong Claude para UI/complejas) ----
  const dev = byRole.get('DEV');
  if (!dev) {
    skipped.push({ role: 'DEV', reason: 'agente ausente/apagado' });
  } else if (!config.FUSION_MODEL_URL || !config.FUSION_TOKEN) {
    skipped.push({ role: 'DEV', reason: 'sin FUSION_MODEL_URL / FUSION_TOKEN' });
  } else {
    const qwen = createOpenAiProvider({
      baseUrl: config.FUSION_MODEL_URL,
      apiKey: config.FUSION_TOKEN,
      model: config.QWEN_MODEL,
    });
    // El strong usa el modelo del Dev si es claude-*, si no el DEV_STRONG_MODEL.
    const strongModel = dev.llmModel.startsWith('claude-') ? dev.llmModel : config.DEV_STRONG_MODEL;
    const strongProvider = config.ANTHROPIC_API_KEY
      ? createAnthropicProvider({ apiKey: config.ANTHROPIC_API_KEY, model: strongModel })
      : undefined;
    handlers.push(
      createDevHandler({
        api: api(dev),
        projectId,
        projectSlug,
        provider: qwen,
        strongProvider,
        gitToken: config.GITHUB_TOKEN,
        maxIterations: config.DEV_MAX_ITERATIONS,
        maxDurationMs: config.AGENT_MAX_DURATION_MS,
      }),
    );
    registered.push(strongProvider ? 'DEV(+strong)' : 'DEV');
  }

  // ---- QA (Claude, modelo del agente) ----
  const qa = byRole.get('QA');
  if (!qa) {
    skipped.push({ role: 'QA', reason: 'agente ausente/apagado' });
  } else {
    const provider = anthropicFor(config, qa.llmModel);
    if (!provider) {
      skipped.push({ role: 'QA', reason: 'sin ANTHROPIC_API_KEY' });
    } else {
      handlers.push(
        createQaHandler({
          api: api(qa),
          projectId,
          projectSlug,
          provider,
          gitToken: config.GITHUB_TOKEN,
          maxDurationMs: config.AGENT_MAX_DURATION_MS,
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
    const provider = anthropicFor(config, rev.llmModel);
    if (!provider) {
      skipped.push({ role: 'REVIEWER', reason: 'sin ANTHROPIC_API_KEY' });
    } else {
      handlers.push(
        createReviewerHandler({
          api: api(rev),
          projectId,
          projectSlug,
          provider,
          gitToken: config.GITHUB_TOKEN,
          maxDurationMs: config.AGENT_MAX_DURATION_MS,
        }),
      );
      registered.push('REVIEWER');
    }
  }

  // ---- RELEASE (Marco: verifica readiness del PR en DONE, advisory) ----
  const release = byRole.get('RELEASE');
  if (release) {
    handlers.push(createReleaseHandler({ api: api(release), projectId, projectSlug, gitToken: config.GITHUB_TOKEN }));
    registered.push('RELEASE');
  } else {
    skipped.push({ role: 'RELEASE', reason: 'agente ausente/apagado' });
  }

  return { projectId, projectSlug, handlers, staleSweep, registered, skipped };
}

/**
 * Modo LEGACY single-project: arma un RuntimeProject desde los tokens por env y
 * registra sus handlers en el router. Se conserva para despliegues 1-proyecto y
 * para los tests existentes.
 */
export function buildTeam(config: AgentsConfig, router: EventRouter): TeamWiring {
  const projectId = config.AGENT_PROJECT_ID;
  const projectSlug = config.AGENT_PROJECT_SLUG;
  if (!projectId || !projectSlug) {
    return { registered: [], skipped: [{ role: '*', reason: 'faltan AGENT_PROJECT_ID / AGENT_PROJECT_SLUG' }], staleSweep: null };
  }

  const roleModel = (role: AgentRoleName): string =>
    role === 'DEV' ? config.QWEN_MODEL : config.ANTHROPIC_MODEL;
  const agents: RuntimeAgent[] = (Object.entries(config.tokens) as Array<[AgentRoleName, string | undefined]>)
    .filter(([, token]) => !!token)
    .map(([role, token]) => ({ role, token: token!, llmModel: roleModel(role), enabled: true }));

  const team = buildProjectTeam(config, { projectId, projectSlug, agents });
  for (const h of team.handlers) router.register(h);
  return { registered: team.registered, skipped: team.skipped, staleSweep: team.staleSweep };
}
