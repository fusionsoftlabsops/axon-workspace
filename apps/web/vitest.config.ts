import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000, // argon2id MODERATE can take a few hundred ms
    // Dummy values so `env()` validation passes. NOT real secrets; the keys
    // decode to exactly 32 bytes as the crypto helpers require. REPOS_ROOT is
    // intentionally left unset so repoReaderFor tests keep using tmp dirs.
    env: {
      DATABASE_URL: 'postgresql://ci:ci@localhost:5432/ci?schema=public',
      AUTH_SECRET: 'test_only_dummy_secret_at_least_32_chars_long',
      AUTH_TOTP_KEY: 'dG90cDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA',
      AUTH_LLM_KEY: 'bGxtITAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA',
      NODE_ENV: 'test',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@admin/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
});
