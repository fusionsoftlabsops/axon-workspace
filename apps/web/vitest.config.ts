import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000, // argon2id MODERATE can take a few hundred ms
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@admin/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
});
