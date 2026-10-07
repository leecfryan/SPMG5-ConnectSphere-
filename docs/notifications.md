# Notification centre — SCRUM-143

## Current scope: iteration 1

The secure inbox identity API is implemented. The React inbox, unread badge and
approval/rejection notifications are later iterations. This is a foundation,
not a completed notification centre. No package or database change is needed yet.

Novu Cloud is the selected inbox provider. The first agreed business event is an
event approval or rejection, notifying its organiser. Assignment/reassignment
notifications belong to the future coordinator story.

## API and ownership

GET /api/notifications/inbox-config requires the existing verified bearer token.
It returns exactly applicationIdentifier (public), subscriberId (req.user.id),
and subscriberHash (HMAC-SHA256 hex of that ID using the backend Novu secret).

All verified signed-in users can request their own identity, including users
without role metadata. This is an account feature like /api/auth/me, not an
internal-staff responsibility, so no role capability is added.

The endpoint accepts no target subscriber ID. Query/header claims cannot change
ownership. There is no per-user URL or POST endpoint. Cache-Control: no-store is
set by requireAuth. Missing/malformed/invalid/expired sessions return 401;
verification outages return 503. Missing/blank Novu configuration returns 503
with a safe sentence, while existing sign-in and account APIs continue to work.

The browser receives a caller-bound signature, never NOVU_SECRET_KEY. Treat
that signature as sensitive authentication material: do not log it or reuse it
across accounts. Later UI must unmount/reset when the account changes.

The signature only protects actual Novu feeds after HMAC enforcement is enabled
in the correct Novu environment. That is not verified by these local tests.

## User setup before the inbox iteration

1. Create a Novu Cloud account and select a development environment. Note its
   US or EU region; the later frontend/API configuration must match that region.
2. In the Novu environment's Novu In-App integration, enable Security HMAC
   encryption. Keep it enabled; a browser-supplied subscriber ID alone is unsafe.
3. Add NOVU_APPLICATION_IDENTIFIER and NOVU_SECRET_KEY to the existing private
   root .env. Copy the application identifier and API key from the same Novu
   environment. Do not paste keys into chat, commit them or put the secret in
   frontend configuration. .env.example contains empty placeholders only.
4. Restart the backend from the repository root with
   npm --prefix backend run dev. If using Docker, restart the backend container.
   With valid configuration, the signed-in caller's inbox-config request should
   return 200. With missing configuration it should return the safe 503 above.
5. The later inbox iteration needs @novu/react, installed by the user under the
   repository rules. It is not needed or installed for this backend-only slice.

Setup references: [Novu production security](https://docs.novu.co/platform/inbox/prepare-for-production)
and [React inbox setup](https://docs.novu.co/platform/inbox/setup-inbox).

## Implementation

- notifications.service.js creates the caller-bound signature using Node's
  built-in crypto module. It reads no environment, makes no network call, and
  returns no configured service if either required setting is blank.
- notifications.controller.js maps a missing service to 503 and reads identity
  only from req.user.id.
- notifications.routes.js attaches requireAuth before the controller.
- app.js mounts /api/notifications; server.js supplies the service from the
  optional environment values. Tests inject a service with dummy settings.

## Acceptance tests — iteration 1

| Test Case ID | Acceptance criterion | Behaviour |
| --- | --- | --- |
| TC-SCRUM-143-01 | AC3 foundation | Correct caller HMAC, only expected public fields, no secret/cache leakage; application-ID whitespace normalised. |
| TC-SCRUM-143-02 | AC3 foundation | Query/header/body and another subscriber URL cannot obtain another user's signature. |
| TC-SCRUM-143-03 | AC3 foundation | Missing, malformed, invalid and expired credentials yield no config. |
| TC-SCRUM-143-04 | AC3 foundation | Consecutive users receive their own distinct identities/signatures. |
| TC-SCRUM-143-05 | AC3 foundation | Every signed-in internal/external role and role-less account can request own config. |
| TC-SCRUM-143-06 | AC3 foundation | Missing, empty or whitespace configuration fails closed; account API remains available. |
| TC-SCRUM-143-07 | AC3 foundation | Provider outage/exception/no-user response yields no config or sensitive provider message. |

These tests use the real Express application over local HTTP, with fake Supabase
verification, dummy Novu keys and independently computed .NET HMAC fixtures. No
Supabase or Novu project is read or changed.

From the repository root, run:

npm --prefix backend run test:events -- tests/integration/notifications.identity.test.js

Expected: all SCRUM-143 identity tests pass. If a test fails, inspect its named
case before configuring a real provider; the suite requires no cloud credentials.

Latest execution: 2026-10-07 — all identity scenarios passed. New service,
controller and router reached 100% statement, branch, function and line coverage.
Targeted lint and isolated auth/permissions, event review/submission and managed
event HTTP regression passed. Full frontend, browser, live Supabase and live Novu
verification were not run for this backend foundation; the story remains open.
Machine-bound check evidence is in the local SCRUM-143 iteration gate ledger.

## Files in this atomic iteration

| File | Reason |
| --- | --- |
| backend/src/modules/notifications/notifications.service.js | Own-inbox HMAC signing with built-in Node crypto. |
| backend/src/modules/notifications/notifications.controller.js | Map unconfigured provider to 503; use only verified identity. |
| backend/src/routes/notifications.routes.js | Authenticate the single inbox-config endpoint. |
| backend/tests/integration/notifications.identity.test.js | Test caller ownership and failure cases over real local HTTP. |
| backend/src/app.js | Inject and mount the notification router. |
| backend/src/server.js | Build the optional signing service from private server configuration. |
| .env.example | Empty Novu setting placeholders; no credentials. |
| docs/notifications.md | This implementation, setup and acceptance-test guide. |
| README.md | Identify the incomplete notification-centre foundation. |
| .agent/docs/architecture.md | Record the new endpoint and local signing contract. |
| AGENTS.md | Keep the existing external-service architecture summary accurate. |

The local task note and gate ledger under .agent/docs/other/ are ignored by the
existing .gitignore; they are not automatically part of a commit. No file has
been staged or committed.

## Schema reference

Iteration 1 requires no SQL, table, policy, trigger or migration. Novu will store
the inbox. Reliable delivery of later business events still needs its own design
and tests before the complete story can be marked done.
