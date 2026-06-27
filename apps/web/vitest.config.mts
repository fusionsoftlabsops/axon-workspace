import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    // Default to node (server actions / lib logic); component tests (*.test.tsx)
    // run under jsdom via environmentMatchGlobs.
    environment: 'node',
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
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
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      // Standard excludes: Next.js entry/shell files, generated types, styles,
      // and the trivial Prisma client singleton carry no testable logic.
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/app/layout.tsx',
        'src/app/loading.tsx',
        'src/app/not-found.tsx',
        'src/app/**/loading.tsx',
        'src/app/**/error.tsx',
        'src/app/**/not-found.tsx',
        'src/lib/db.ts',
        'src/**/*.scss',
        'src/instrumentation.ts',
      ],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@admin/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
});
