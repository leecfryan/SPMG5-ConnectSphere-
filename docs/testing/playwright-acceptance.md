# Playwright browser and backend API acceptance tests

The root Playwright runner complements the frontend Vitest/React Testing Library
suite and the existing backend Node integration tests. Every test has a unique
ID and a descriptive title. There are 17 Chromium browser tests and 71 HTTP API
tests, including 48 individual role/permission combinations.

Verified locally on 2026-09-18: **88 passed, 0 failed, 0 skipped, 0 flaky**.
The existing backend integration suite also passed all 28 tests.

## What runs

Browser tests use the real React application, BrowserRouter, Vite proxy, browser
storage, frontend Supabase SDK, Express application, backend Supabase SDK and
authentication/permission middleware. They do not intercept or replace the
application's `/api` responses. Supabase Auth is a **local test-only HTTP
simulator** with disposable accounts. The suite needs no `.env`, real passwords,
Supabase project, Docker containers or database.

```text
Chromium -> Vite :43173 -> Express :43000 -> Auth simulator :43001
    |                                           ^
    +------------ real Supabase SDK ------------+
Playwright APIRequestContext -> Express :43000
```

The application routes `/api/auth/config`, `/api/auth/me`, `/api/internal/access`
and `/api/health` are real. `/api/internal/fixtures/...` exists only in the test
launcher to exercise the real permission middleware and record-access contract.
These fixtures are not implemented venue/equipment/client features. The simulator
issues test tokens from an in-memory allowlist; it does not validate JWT signatures
or replicate all GoTrue behavior.

## Install and run

Use Node.js 22. Run from the **repository root**, not `frontend` or `backend`:

```powershell
npm ci
npm --prefix frontend ci
npm --prefix backend ci
npx playwright install chromium

npm run test:playwright
npm run test:e2e
npm run test:api
```

`test:playwright` runs everything; `test:e2e` runs Chromium tests only and
`test:api` runs direct HTTP tests only. API-only runs do not need a browser
download. All commands automatically start and stop the isolated test servers.
Existing development servers and Docker ports 5173/5174/3000 are unchanged.

```powershell
# Inspect the saved HTML report or use Playwright's interactive runner.
npm run test:playwright:report
npm run test:playwright:ui

# Run one acceptance case, visibly in Chromium.
npm run test:e2e -- --grep E2E-AUTH-001 --headed

# Existing, separate backend integration tests.
npm --prefix backend test
```

HTML results are saved in `playwright-report/`; JSON results, failure screenshots
and traces are under `test-results/`. These directories are ignored by Git. Each
run replaces the previous report, so rerun `test:playwright` for a combined report.
The HTML report provides the exact ID, title and result for every executed case.

## Acceptance traceability

| Acceptance criterion | Browser evidence | Direct API evidence |
| --- | --- | --- |
| Valid authentication grants system access | E2E-AUTH-001; role-specific deep links E2E-RBAC-001–003 | API-AUTH-006 verifies returned identity; API-RBAC permits authorized requests |
| Invalid authentication keeps protected functionality inaccessible | E2E-AUTH-002/003/005/006 | API-AUTH-001–005/007/008 reject missing, malformed, unknown and revoked credentials and provider failures |
| Sign-in establishes identity for later authorization | E2E-AUTH-001/004/007/008 cover reload, sign-out, cross-tab changes and SDK refresh | API-AUTH-006/007 and API-RBAC-049 verify trusted identity and fresh checks on later requests |
| Team may propose the authentication method | Real SDK email/password flow exercises the chosen implementation | API-CONFIG-001 checks the public configuration contract; this criterion is a design allowance, not security certification |
| Venue Staff access venue responsibilities | E2E-RBAC-001 | API-RBAC-001–008 |
| Technical Support Staff access equipment/support responsibilities | E2E-RBAC-002 | API-RBAC-009–016 |
| Access is based on role/responsibility rather than merely venue/type/location | Role-specific responsibility pages | API-SCOPE-001 exercises middleware with different resources and unrelated profile metadata |
| Unauthorized users cannot access protected internal information | E2E-RBAC-004–008 | API-RBAC denial cases, API-DENY, API-WRITE and API-RECORD; denied handlers never run |

The final RBAC sentence was clipped in the supplied screenshot. The tests cover
the visible requirement to deny protected information to unauthorized users.

## Test files and isolation

- `tests/playwright/browser.spec.cjs`: browser sign-in, validation, reload,
  refresh, sign-out, cross-tab behavior, role pages, denied direct URLs, history,
  revoked roles and not-found recovery.
- `tests/playwright/api.spec.cjs`: real HTTP requests, exact response contracts,
  no-store headers, trusted roles, direct permission checks, record denial and
  read-versus-write enforcement.
- `tests/playwright/support/server.cjs`: starts the production `createApp` factory
  with a real SDK pointed at the local simulator, plus explicit test-only routes.
- `tests/playwright/support/fixtures.cjs`: provisions a unique random account per
  test. Tests do not reset shared users or depend on execution order.
- `tests/playwright/support/frontend.cjs`: starts Vite using the existing frontend
  config with test-specific host, port and proxy target.
- `playwright.config.cjs`: separate API/Chromium projects, two workers, strict
  server ownership and failure artifacts. CI allows one retry and reports flakes.

Control endpoints require a random per-run key and all services bind to loopback.
No test auth code is imported by production startup or added to Docker images.
Do not deploy the test launcher. Test credentials are synthetic and disposable.

The existing `event_ops_manager` policy lacks `internal.access`, so the tests
expect denial at that gate despite its `event_organisers.read` capability. This
records current behavior; it does not establish business approval of that policy.

## Ports and CI

Occupied test ports produce an error; the runner never silently reuses another
server or moves to a different port. Override all three when running a second
suite concurrently:

```powershell
$env:PW_FRONTEND_PORT = '44173'
$env:PW_BACKEND_PORT = '44000'
$env:PW_AUTH_PORT = '44001'
npm run test:playwright
```

The CI workflow installs root/frontend/backend dependencies and Chromium, runs
both projects, and uploads reports and failure traces for 14 days. The new job
uses no Supabase secrets. CI configuration is supplied here; local execution
does not establish that GitHub Actions has run successfully.

## Remaining evidence

This is browser-to-backend acceptance coverage with a simulated external Auth
service. It does not prove live Supabase credential verification, cryptographic
JWT rejection, database/RLS rules, real event relationship queries, production
HTTPS/SPA rewrites, or Firefox/WebKit behavior. Live acceptance should use a
dedicated test Supabase project and actual feature endpoints once they exist.
The record resolver here uses test-owned fixtures, not a database. Complete story
acceptance still requires those integrations.

References: [Playwright web servers](https://playwright.dev/docs/test-webserver)
and [Playwright API testing](https://playwright.dev/docs/api-testing).
