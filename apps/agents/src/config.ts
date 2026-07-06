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
  // Token de servicio (scope agents:runtime) con el que el worker obtiene los
  // equipos de TODOS los proyectos vía /internal/agent-runtime. Sin él, el
  // worker no tiene equipos que atender y arranca en modo pasivo/oscuro.
  AGENT_RUNTIME_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // Cada cuánto re-consulta el worker el runtime (toma proyectos/agentes nuevos).
  AGENT_RUNTIME_REFRESH_SEC: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(15).max(600).default(45),
  ),
  // Modelo Qwen propio (vLLM OpenAI-compatible) para el rol Dev.
  FUSION_MODEL_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  FUSION_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  QWEN_MODEL: z.preprocess((v) => (v === '' ? undefined : v), z.string().default('qwen3-coder-next')),
  // Claude (credencial server de la instancia) para los roles SM/QA.
  ANTHROPIC_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  ANTHROPIC_MODEL: z.preprocess((v) => (v === '' ? undefined : v), z.string().default('claude-sonnet-5')),
  // Modelo fuerte del Dev para HUs de UI/complejas (Claude), donde Qwen no
  // converge. Usa la misma ANTHROPIC_API_KEY. Si no hay key, el Dev usa siempre Qwen.
  DEV_STRONG_MODEL: z.preprocess((v) => (v === '' ? undefined : v), z.string().default('claude-sonnet-5')),
  // Proveedor git (instance-wide). Default 'github' → comportamiento idéntico al
  // histórico; 'forgejo' habilita Forgejo/Gitea (p.ej. git.fusion-soft-lab.com).
  GIT_PROVIDER: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['github', 'forgejo']).default('github'),
  ),
  // Base de la API REST del proveedor. GitHub: https://api.github.com;
  // Forgejo/Gitea: https://<host>/api/v1 (p.ej. https://git.fusion-soft-lab.com/api/v1).
  GIT_API_BASE_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().url().default('https://api.github.com'),
  ),
  // Host git para armar/parsear URLs de repo. GitHub: github.com; Forgejo: el
  // dominio del servidor (p.ej. git.fusion-soft-lab.com).
  GIT_HOST: z.preprocess((v) => (v === '' ? undefined : v), z.string().default('github.com')),
  // PAT del proveedor git configurado (GITHUB_TOKEN por compatibilidad de nombre):
  // su VALOR es un token de GitHub cuando GIT_PROVIDER=github y un token de Forgejo
  // cuando GIT_PROVIDER=forgejo. Se usa para clone/push/PR del Dev y clone de QA.
  GITHUB_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // Intervalo del sweep de estancadas del SM (minutos; 0 = apagado).
  STALE_SWEEP_MINUTES: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(0).default(30),
  ),
  // Tope de iteraciones del loop del Dev (tuning post-dogfooding; default 40).
  DEV_MAX_ITERATIONS: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(4).max(200).default(40),
  ),
  // Tope de reloj (ms) del run completo de Dev/QA — defensa contra hangs sin
  // timeout propio (post-dogfooding: un run se quedó sin resolver ~20 min
  // pese a que cada llamada individual tenía su propio timeout). Default 20min.
  AGENT_MAX_DURATION_MS: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(60_000).max(3_600_000).default(1_200_000),
  ),
  // Health endpoint del worker (fusion-infra healthCheckPath=/health).
  PORT: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().positive().default(3060)),
});

export type AgentsConfig = z.infer<typeof schema> & {
  enabled: boolean;
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
  };
}
