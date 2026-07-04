/**
 * Cableado del equipo (axon#19): construye los clientes/providers por rol a
 * partir de la config y registra los handlers en el router. Separado del
 * index.ts (bootstrap con side effects) para que el wiring sea testeable.
 *
 * Cada rol se activa solo si tiene TODO lo que necesita (token de miembro +
 * proveedor LLM cuando aplica); lo que falte se reporta en `skipped` — el
 * worker arranca igual con el resto del equipo.
 */
import type { AgentsConfig } from './config.js';
import { EventRouter } from './router.js';
import { AxonApi } from './api/client.js';
import { createOpenAiProvider } from './runtime/providers/openai.js';
import { createAnthropicProvider } from './runtime/providers/anthropic.js';
import { createSmAssignHandler } from './roles/sm.js';
import { createSmRetroHandler } from './roles/sm-retro.js';
import { createPoHandler } from './roles/po.js';
import { createDesignHandler } from './roles/design.js';
import { createReviewerHandler } from './roles/reviewer.js';
import { createSmStaleSweep } from './roles/sm-stale.js';
import { createDevHandler } from './roles/dev.js';
import { createQaHandler } from './roles/qa.js';

export interface TeamWiring {
  registered: string[];
  skipped: Array<{ role: string; reason: string }>;
  /** Sweep de estancadas del SM (el llamador decide el intervalo). */
  staleSweep: { sweepOnce(): Promise<number> } | null;
}

export function buildTeam(config: AgentsConfig, router: EventRouter): TeamWiring {
  const registered: string[] = [];
  const skipped: Array<{ role: string; reason: string }> = [];
  let staleSweep: TeamWiring['staleSweep'] = null;

  const projectId = config.AGENT_PROJECT_ID;
  const projectSlug = config.AGENT_PROJECT_SLUG;
  if (!projectId || !projectSlug) {
    skipped.push({ role: '*', reason: 'faltan AGENT_PROJECT_ID / AGENT_PROJECT_SLUG' });
    return { registered, skipped, staleSweep };
  }

  const anthropic = config.ANTHROPIC_API_KEY
    ? createAnthropicProvider({ apiKey: config.ANTHROPIC_API_KEY, model: config.ANTHROPIC_MODEL })
    : null;

  const poEnabled = !!config.tokens.PO;
  const designEnabled = !!config.tokens.DESIGN;

  // ---- SM ----
  if (config.tokens.SM) {
    const api = new AxonApi(config.AXON_API_BASE_URL, config.tokens.SM);
    // Con PO activo, el SM asigna solo HUs refinadas (gate de Definition of Ready).
    // Con Diseño activo, las HUs de UI esperan su spec de diseño (gate de diseño).
    router.register(createSmAssignHandler({ api, projectId, projectSlug, poEnabled, designEnabled }));
    registered.push('SM:assign');
    if (anthropic) {
      router.register(createSmRetroHandler({ api, projectId, projectSlug, provider: anthropic }));
      registered.push('SM:retro');
    } else {
      skipped.push({ role: 'SM:retro', reason: 'sin ANTHROPIC_API_KEY' });
    }
    staleSweep = createSmStaleSweep({ api, projectId, projectSlug, provider: anthropic ?? undefined });
    registered.push('SM:stale-sweep');
  } else {
    skipped.push({ role: 'SM', reason: 'sin AGENT_SM_TOKEN' });
  }

  // ---- PO (refina el backlog: DoR + DoD) ----
  if (config.tokens.PO) {
    const api = new AxonApi(config.AXON_API_BASE_URL, config.tokens.PO);
    router.register(createPoHandler({ api, projectId, projectSlug }));
    registered.push('PO');
  } else {
    skipped.push({ role: 'PO', reason: 'sin AGENT_PO_TOKEN' });
  }

  // ---- DESIGN (Aria: diseña las HUs de UI antes del Dev) ----
  if (config.tokens.DESIGN) {
    const api = new AxonApi(config.AXON_API_BASE_URL, config.tokens.DESIGN);
    router.register(createDesignHandler({ api, projectId, projectSlug }));
    registered.push('DESIGN');
  } else {
    skipped.push({ role: 'DESIGN', reason: 'sin AGENT_DESIGN_TOKEN' });
  }

  // ---- DEV (Qwen) ----
  if (!config.tokens.DEV) {
    skipped.push({ role: 'DEV', reason: 'sin AGENT_DEV_TOKEN' });
  } else if (!config.FUSION_MODEL_URL || !config.FUSION_TOKEN) {
    skipped.push({ role: 'DEV', reason: 'sin FUSION_MODEL_URL / FUSION_TOKEN' });
  } else {
    const api = new AxonApi(config.AXON_API_BASE_URL, config.tokens.DEV);
    const qwen = createOpenAiProvider({
      baseUrl: config.FUSION_MODEL_URL,
      apiKey: config.FUSION_TOKEN,
      model: config.QWEN_MODEL,
    });
    // Modelo fuerte para HUs de UI/complejas (Claude): mismo tool-loop que el QA.
    // Sin ANTHROPIC_API_KEY, el Dev usa siempre Qwen (degradación limpia).
    const strongProvider = config.ANTHROPIC_API_KEY
      ? createAnthropicProvider({ apiKey: config.ANTHROPIC_API_KEY, model: config.DEV_STRONG_MODEL })
      : undefined;
    router.register(
      createDevHandler({
        api,
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

  // ---- QA (Claude) ----
  if (!config.tokens.QA) {
    skipped.push({ role: 'QA', reason: 'sin AGENT_QA_TOKEN' });
  } else if (!anthropic) {
    skipped.push({ role: 'QA', reason: 'sin ANTHROPIC_API_KEY' });
  } else {
    const api = new AxonApi(config.AXON_API_BASE_URL, config.tokens.QA);
    router.register(
      createQaHandler({
        api,
        projectId,
        projectSlug,
        provider: anthropic,
        gitToken: config.GITHUB_TOKEN,
        maxDurationMs: config.AGENT_MAX_DURATION_MS,
      }),
    );
    registered.push('QA');
  }

  // ---- REVIEWER (Ren: code review de calidad, advisory) ----
  if (!config.tokens.REVIEWER) {
    skipped.push({ role: 'REVIEWER', reason: 'sin AGENT_REVIEWER_TOKEN' });
  } else if (!anthropic) {
    skipped.push({ role: 'REVIEWER', reason: 'sin ANTHROPIC_API_KEY' });
  } else {
    const api = new AxonApi(config.AXON_API_BASE_URL, config.tokens.REVIEWER);
    router.register(
      createReviewerHandler({
        api,
        projectId,
        projectSlug,
        provider: anthropic,
        gitToken: config.GITHUB_TOKEN,
        maxDurationMs: config.AGENT_MAX_DURATION_MS,
      }),
    );
    registered.push('REVIEWER');
  }

  return { registered, skipped, staleSweep };
}
