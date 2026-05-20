import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests live next to the code they cover — core under src/**,
    // CLI under packages/cli/src/**.
    include: ['src/**/*.{test,spec}.ts', 'packages/**/src/**/*.{test,spec}.ts'],
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      // Exclude type-only and integration-heavy wiring from coverage targets;
      // these are covered by example services / e2e, not unit tests.
      exclude: [
        'src/types.ts',
        'src/**/types.ts',
        'src/index.ts',
        'src/configs/**',
        'src/**/*.test.ts',
      ],
    },
  },
});
