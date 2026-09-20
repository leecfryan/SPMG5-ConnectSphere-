# Event request and shared authentication integration

PR #2 combines `feature/eventRequest` with the SignIn foundation already on
`main`. Keep both feature implementations and both testing stacks.

## User flow and access

- Event Organisers receive the `events.submit` capability from the verified
  backend identity. Multiple roles retain the union of their capabilities.
- The shared workspace links to `/events/new` when this permission is present.
  Direct navigation requires both `RequireAuth` and `RequirePermission`.
- `/account` remains the default post-login destination. A permitted bookmarked
  `/events/new` destination is restored after sign-in.
- The existing form, all validation, timezone conversion, optional requirements,
  submitted summary and "Submit another request" action are preserved.
- The browser attaches the current bearer token. Express verifies it on every
  submission, checks `events.submit`, and uses `req.user.id` for ownership.
  Caller-provided organiser IDs, statuses and coordinator IDs are ignored.
- `events.submit` is an external capability; organisers do not gain internal
  staff access. Staff-only accounts cannot submit on an organiser's behalf.
  A later on-behalf workflow requires an explicit policy and acceptance story.

## Runtime setup

Use the root `.env` with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and
`SUPABASE_SECRET_KEY`. The last is required for server-side event persistence
as implemented by this feature; it is never sent to the browser. Without it,
sign-in remains available and authorized submissions return 503.

The existing `events` table and its schema/constraints are prerequisites. This
integration does not apply migrations, change live data or verify production RLS.
The former fixed development organiser ID has been removed. Existing test rows
are not reassigned or deleted.

## Test runners

From the repository root:

```powershell
npm ci
npm --prefix frontend ci
npm --prefix backend ci
npx playwright install chromium
npm --prefix backend test
npm --prefix backend run check
npm --prefix frontend test -- --run --maxWorkers=1
npm --prefix frontend run lint
npm --prefix frontend run build
npm run test:playwright
```

Backend `test` runs the original Node authentication/RBAC suite followed by the
event feature's Vitest suites. `test:auth` and `test:events` run them separately;
event coverage/watch/UI commands remain available. The frontend preserves the
HTML report/dashboard and the event suite's UTC+8 timezone tests. Frontend
Vitest/UI/coverage packages use the same version, 5.0.1.

On this Windows checkout a fork worker timed out during startup. Retrying with
`npm --prefix frontend test -- --run --maxWorkers=1 --pool=threads` passed. This
is a runner option, not a change to application behavior.

Playwright now discovers `*browser.spec.cjs` and `*api.spec.cjs`, including
`events.browser.spec.cjs` and `events.api.spec.cjs`. New cases exercise the real
event API, guards, service and validation, replacing only Auth transport and
event storage with local fixtures. They verify successful organizer-owned
submission, all missing fields, denied roles, role removal and failure/retry.
Live Supabase persistence must still be checked with an agreed test account.

## Conflict decisions

- Keep the shared router and workspace from `main`; add the feature page as a
  guarded route instead of replacing the entire application.
- Combine event-form styling with workspace navigation styling.
- Keep the `createApp` backend entry point; mount the protected events router
  there, injecting the event repository for production or isolated tests.
- Preserve both dependency sets and regenerate the frontend lockfile.
- Preserve all report, coverage and OS-file ignores.
- Run both backend runners in CI rather than silently dropping either suite.

The older story test catalogs describe their original scope. This document
records the merged runtime and the added authorization integration.
