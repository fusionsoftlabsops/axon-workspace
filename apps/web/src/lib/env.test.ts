import { afterEach, describe, expect, it, vi } from 'vitest';

describe('env', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('parses valid environment variables and caches the result', async () => {
    vi.resetModules();
    const { env } = await import('./env');
    const first = env();
    expect(first.DATABASE_URL).toContain('postgresql://');
    expect(first.NODE_ENV).toBe('test');
    // Defaults applied for unset optional vars.
    expect(first.S3_REGION).toBe('us-east-1');
    expect(first.S3_BUCKET).toBe('axon');
    // Second call returns the cached object (same reference).
    expect(env()).toBe(first);
  });

  it('throws a descriptive error when a variable is invalid', async () => {
    vi.resetModules();
    vi.stubEnv('DATABASE_URL', 'not-a-valid-url');
    const { env } = await import('./env');
    expect(() => env()).toThrow(/Invalid environment variables/);
    expect(() => env()).toThrow(/DATABASE_URL/);
  });

  it('throws when AUTH_SECRET is too short', async () => {
    vi.resetModules();
    vi.stubEnv('AUTH_SECRET', 'short');
    const { env } = await import('./env');
    expect(() => env()).toThrow(/AUTH_SECRET/);
  });
});
