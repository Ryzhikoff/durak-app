import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts', 'test/**/*.e2e-spec.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  esbuild: {
    target: 'es2022',
  },
});
