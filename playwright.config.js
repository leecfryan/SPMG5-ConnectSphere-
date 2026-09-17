import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // E2E tests hit a shared database — keep them serial so tests don't
  // stomp on each other's seed state.
  fullyParallel: false,
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm --prefix frontend run dev',
    url: 'http://localhost:5173',
    // Reuse an already-running dev server in local dev; always start fresh in CI.
    reuseExistingServer: !process.env.CI,
  },
  outputDir: 'tests/e2e/results',
})
