const path = require("node:path");
// Loads the root .env (SEED_USER_PASSWORD, SUPABASE_*, PORT) into this
// process before webServer spawns the backend/frontend dev servers below -
// child processes inherit process.env, so this is the only place that needs
// to load it. Same file backend/scripts/seedUsers.js and the backend
// integration tests already load.
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: ".",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // reuseExistingServer: true so this also works if you already have
  // `docker compose up` or `npm run dev` running in another terminal -
  // it won't try to double-start anything on those ports.
  webServer: [
    {
      command: "npm run dev",
      cwd: path.resolve(__dirname, "../../backend"),
      url: "http://localhost:3000/api/health",
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "npm run dev",
      cwd: path.resolve(__dirname, "../../frontend"),
      url: "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
