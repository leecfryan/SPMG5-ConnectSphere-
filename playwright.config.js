const { defineConfig, devices } = require('@playwright/test')
const { randomUUID } = require('node:crypto')
const { frontendURL, backendURL } = require('./tests/playwright/support/settings.cjs')

// Assign a fresh key each run so the control endpoint is only reachable during
// this process's lifetime. Server inherits it via webServer.env.
process.env.PW_CONTROL_KEY ||= randomUUID()

module.exports = defineConfig({
  testDir: './tests/playwright',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testMatch: '**/browser.spec.cjs',
      use: { ...devices['Desktop Chrome'], baseURL: frontendURL },
    },
  ],
  webServer: [
    {
      command: 'node tests/playwright/support/server.cjs',
      url: `${backendURL}/api/health`,
      env: { PW_CONTROL_KEY: process.env.PW_CONTROL_KEY },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'node tests/playwright/support/frontend.cjs',
      url: frontendURL,
      env: { API_PROXY_TARGET: backendURL },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
  outputDir: 'tests/playwright/results',
})
