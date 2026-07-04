import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 chars (use `openssl rand -base64 32`)'),
  AUTH_URL: z.string().url().optional(),
  AUTH_TRUST_HOST: z.string().optional(),
  AUTH_TOTP_KEY: z
    .string()
    .min(32, 'AUTH_TOTP_KEY must be at least 32 base64url chars (32 bytes of entropy)')
    .optional(),
  // Dedicated key for sealing LLM API keys at rest, separate from AUTH_TOTP_KEY
  // so a leak of one does not compromise both 2FA secrets and LLM keys.
  AUTH_LLM_KEY: z
    .string()
    .min(32, 'AUTH_LLM_KEY must be at least 32 base64url chars (32 bytes of entropy)')
    .optional(),
  // When set, restricts every project `repoPath` to live inside this base
  // directory. Without it, an OWNER/ADMIN could point repoPath at any absolute
  // path on the server. Strongly recommended in shared/self-hosted deployments.
  REPOS_ROOT: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().optional(),
  ),
  // Accept either an unset value or a properly-prefixed key. An empty string
  // (common when .env has `ANTHROPIC_API_KEY=`) is normalized to undefined.
  ANTHROPIC_API_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().startsWith('sk-ant-').optional(),
  ),
  // OpenAI (gpt-image-1) para generación de imágenes de UI/UX (mockups + assets).
  // Opcional: sin ella, la generación de imágenes devuelve un error claro y el
  // resto de la app no se ve afectada.
  OPENAI_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-1'),
  // SMTP for outbound email (e.g. invitation links). All optional — if unset,
  // email sending is skipped and the app falls back to the copyable link.
  // Works with any SMTP provider (Hostinger, Resend's smtp.resend.com, etc.).
  SMTP_HOST: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  SMTP_PORT: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  SMTP_USER: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  SMTP_PASS: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  SMTP_FROM: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  SMTP_SECURE: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // Object storage (MinIO / S3-compatible) for the per-project file store.
  // All optional — if unset, the file routes return a clear "storage not
  // configured" error and the rest of the app is unaffected.
  S3_ENDPOINT: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  S3_SECRET_ACCESS_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  S3_BUCKET: z.string().default('axon'),
  // MinIO needs path-style addressing (bucket in the path, not the host).
  S3_FORCE_PATH_STYLE: z.preprocess((v) => v !== 'false', z.boolean().default(true)),
  AI_MODEL_FAST: z.string().default('claude-haiku-4-5-20251001'),
  AI_MODEL_BALANCED: z.string().default('claude-sonnet-4-6'),
  AI_MODEL_DEEP: z.string().default('claude-opus-4-8'),
  // Self-hosted LLM (Ollama on fusion-infra, reachable on the internal `fusion`
  // network) used for the context-graph summaries — keeps that cost off Anthropic.
  // Optional: if unset, the graph still works and summaries are simply disabled.
  INFRA_LLM_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  INFRA_LLM_MODEL: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // graphify-svc (self-hosted, reachable on the internal `fusion` network) that
  // clones a project's repos and returns a code knowledge graph. Optional: if
  // unset, isGraphifyConfigured() is false and "Analyze existing project" is
  // disabled, leaving greenfield planning untouched. See apps/graphify-svc.
  GRAPHIFY_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  // Bearer token Axon forwards to graphify-svc (matches its GRAPHIFY_AUTH_TOKEN).
  GRAPHIFY_AUTH_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // Default extraction backend for graphify-svc (deepseek|claude|…). Optional —
  // the service has its own default when this is unset.
  GRAPHIFY_BACKEND: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // GitHub org PAT used to create repos and read collaborator access for the
  // plan's Repositories section. Optional — if unset, those actions are disabled
  // and the rest of the app is unaffected.
  GITHUB_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  GITHUB_ORG: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // fusion-infra control-plane (the user's PaaS). axon-web runs as an app ON
  // fusion-infra (the internal `fusion` network), so this is the internal API
  // base: http://control-plane:3030/api. Optional: if unset, isFusionConfigured()
  // is false and the project "Deploy" tab shows a friendly "not configured"
  // notice, leaving the rest of the app untouched. See lib/deploy/fusion-client.ts.
  FUSION_INFRA_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  // Platform `fapi_` API token Axon presents to the control-plane (Bearer). Mint
  // it once in the fusion-infra Settings UI. Required (with the URL) to deploy.
  FUSION_INFRA_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // Optional overrides. TEAM_ID skips the /context defaultTeam lookup; SERVER_ID
  // pins which host new apps deploy to (auto-picked when there's exactly one).
  FUSION_INFRA_TEAM_ID: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  FUSION_INFRA_SERVER_ID: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // Redis for realtime pub/sub (collaborative plan chat: live messages, typing,
  // presence) across replicas. Optional: if unset, realtime degrades to an
  // in-process EventEmitter (works for a single replica). Redis already runs in
  // fusion-infra. See lib/realtime.ts.
  REDIS_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  // Public base URL of the fusion-infra control-plane that serves the "Fusion
  // Code" installer (`${base}/api/coding-tools/install.{sh,ps1}`) and hosts the
  // Coding Tools page. Used by the project "Desarrollar" onboarding to build the
  // one-line install command. Optional: if unset, the guide shows manual steps.
  FUSION_CODE_BASE_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  // Public URL of the Axon MCP (the `axon` MCP server Fusion Code / Qwen talks
  // to). Shown in the onboarding config snippet. Defaults to the deployed one.
  AXON_MCP_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().url().default('https://mcp-axon.fusion-soft-lab.com/mcp'),
  ),
  // Plataforma agéntica: cuando está activo ('1'|'true'|'on'), axon-web publica
  // eventos de dominio de HUs (creación / cambio de estado / comentario) en el
  // canal Redis que consume el worker axon-agents. Opt-in: apagado por defecto,
  // la feature se despliega oscura. See lib/agents/events.ts.
  AGENT_EVENTS_ENABLED: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

let cached: z.infer<typeof schema> | null = null;

export function env() {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
