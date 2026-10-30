import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './browser',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:4178',
    browserName: 'chromium',
    actionTimeout: 5000,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/browser-server.mjs',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
  },
});
