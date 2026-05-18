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
  // Accept either an unset value or a properly-prefixed key. An empty string
  // (common when .env has `ANTHROPIC_API_KEY=`) is normalized to undefined.
  ANTHROPIC_API_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().startsWith('sk-ant-').optional(),
  ),
  AI_MODEL_FAST: z.string().default('claude-haiku-4-5-20251001'),
  AI_MODEL_BALANCED: z.string().default('claude-sonnet-4-6'),
  AI_MODEL_DEEP: z.string().default('claude-opus-4-7'),
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
