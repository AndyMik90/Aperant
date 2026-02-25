/**
 * Playwright configuration for Electron E2E tests
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false, // Run tests serially for Electron
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for Electron
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'electron',
      testMatch: '**/*.e2e.ts'
    }
  ]
});
