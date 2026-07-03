/**
 * Configuración del worker axon-agents. Todo por env, validado con zod al
 * arrancar. El interruptor maestro es AGENTS_ENABLED: sin él el worker arranca
 * en modo pasivo (health OK, sin suscripción) para poder desplegarse oscuro.
 */
import { z } from 'zod';

const schema = z.object({
  // Interruptor maestro del worker (opt-in, igual que AGENT_EVENTS_ENABLED en axon-web).
  AGENTS_ENABLED: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // Redis compartido con axon-web (axon-redis en fusion-infra).
  REDIS_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  // Admin API v1 de axon-web (red interna `fusion`): la superficie de los agentes.
  AXON_API_BASE_URL: z
    .preprocess((v) => (v === '' ? undefined : v), z.string().url().optional())
    .default('http://axon-web:3000/api/v1'),
  // Tokens de miembro por rol (acuñados con provisionAgentAction). Un rol sin
  // token queda inactivo aunque el worker esté encendido.
  AGENT_SM_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  AGENT_DEV_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  AGENT_QA_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // Proyecto que este worker atiende (v1: un proyecto por instancia).
  AGENT_PROJECT_ID: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  AGENT_PROJECT_SLUG: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // Modelo Qwen propio (vLLM OpenAI-compatible) para el rol Dev.
  FUSION_MODEL_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  FUSION_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  QWEN_MODEL: z.preprocess((v) => (v === '' ? undefined : v), z.string().default('qwen3-coder-next')),
  // Claude (credencial server de la instancia) para los roles SM/QA.
  ANTHROPIC_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  ANTHROPIC_MODEL: z.preprocess((v) => (v === '' ? undefined : v), z.string().default('claude-sonnet-4-6')),
  // Token de GitHub para clone/push/PR del Dev y clone de QA (repos privados).
  GITHUB_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // Intervalo del sweep de estancadas del SM (minutos; 0 = apagado).
  STALE_SWEEP_MINUTES: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(0).default(30),
  ),
  // Health endpoint del worker (fusion-infra healthCheckPath=/health).
  PORT: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().positive().default(3060)),
});

export type AgentsConfig = z.infer<typeof schema> & {
  enabled: boolean;
  tokens: { SM?: string; DEV?: string; QA?: string };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentsConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  const v = parsed.data.AGENTS_ENABLED?.toLowerCase();
  return {
    ...parsed.data,
    enabled: v === '1' || v === 'true' || v === 'on',
    tokens: {
      SM: parsed.data.AGENT_SM_TOKEN,
      DEV: parsed.data.AGENT_DEV_TOKEN,
      QA: parsed.data.AGENT_QA_TOKEN,
    },
  };
}
