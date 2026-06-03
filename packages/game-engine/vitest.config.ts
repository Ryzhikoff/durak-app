import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.spec.ts', 'tests/**/*.test.ts', 'src/**/*.spec.ts'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
  esbuild: {
    target: 'es2022',
  },
});
