import { defineConfig } from '@playwright/test';
import production from './playwright.config';

// Focused startup coverage: the production suite does not exercise effect replay.
export default defineConfig({
  ...production,
  testDir: './tests/dev-e2e',
  workers: 1,
  retries: 0,
  use: { ...production.use, baseURL: 'http://localhost:3101' },
  webServer: {
    command: 'pnpm dev --hostname localhost --port 3101',
    env: { INCIDENT_ROOM_DEV_E2E: '1' },
    url: 'http://localhost:3101',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
