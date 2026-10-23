import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['tests/unit/**/*.test.ts'],
      exclude: ['tests/fixtures/**', 'tests/e2e/**', 'node_modules/**'],
      environment: 'node',
      testTimeout: 30_000,
    },
  }),
);
