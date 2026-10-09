import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    // These suites run separately using Node's test runner.
    exclude: ["tests/unit/equipment/**", "tests/integration/auth.test.js", "tests/integration/permissions.test.js"],
    environment: "node",
    // Live-DB integration suites make many sequential round trips to the shared
    // free-tier Supabase project; the 5s default is too tight on CI.
    testTimeout: 15000,
    hookTimeout: 15000,
    // Test names lead with the Jira key, so the per-test lines the verbose
    // reporter prints are the traceability report docs/event-request-tests.md
    // cites. A summary-only reporter would drop that evidence.
    reporters: ["verbose"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.js"],
      // Wiring, not logic: server.js boots a listener, checkSupabase.js is a
      // one-off script, and supabase.js only constructs the client (it is
      // stubbed in every test and throws without real env vars). None can be
      // unit tested, so counting them only depresses the reported number.
      exclude: ["src/server.js", "src/checkSupabase.js", "src/supabase.js"],
    },
  },
});
