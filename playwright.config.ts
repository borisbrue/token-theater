import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173';

/** Server-Presets für TST-0014 (CON-0013); der Fake-Server liegt auf dem eigenen Origin. */
const TEST_PRESETS = [
  {
    name: 'Test-vLLM',
    baseUrl: `${baseURL}/fake-llm/v1`,
    model: 'Qwen3.5-0.8B',
    dialect: 'legacy',
  },
  {
    name: 'Test-MLX',
    baseUrl: `${baseURL}/fake-llm/v1`,
    model: 'mlx-test',
    dialect: 'content',
    apiKey: 'sk-optiq-test',
  },
];

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL,
    acceptDownloads: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort --host 127.0.0.1',
    url: baseURL,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    env: { VITE_REMOTE_PRESETS: JSON.stringify(TEST_PRESETS) },
  },
});
