const { defineConfig, devices } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { frontendURL, backendURL } = require('./tests/playwright/support/settings.cjs');

process.env.PW_CONTROL_KEY ||= randomUUID();

module.exports = defineConfig({
  testDir: './tests/playwright',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'api', testMatch: '**/api.spec.cjs', use: { baseURL: backendURL } },
    { name: 'chromium', testMatch: '**/browser.spec.cjs', use: { ...devices['Desktop Chrome'], baseURL: frontendURL } },
  ],
  webServer: [
    {
      command: 'node tests/playwright/support/server.cjs',
      url: backendURL + '/api/health',
      env: { PW_CONTROL_KEY: process.env.PW_CONTROL_KEY },
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: 'node tests/playwright/support/frontend.cjs',
      url: frontendURL,
      env: { API_PROXY_TARGET: backendURL },
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
