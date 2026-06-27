import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        // Pure bootstrap entrypoints: top-level side effects on import
        // (read env, exit, server.connect / app.listen). No exported logic
        // to unit-test; their wiring is exercised indirectly via the units.
        'src/index.ts',
        'src/http.ts',
      ],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 80,
      },
    },
  },
});
