# Registration test guide

Registration acceptance-test commands, AC-to-test traceability and coverage notes.
Per-story task notes live in [`.agent/docs/other/`](../../.agent/docs/other/).

> Status: this guide starts with the waitlist story (SCRUM-151). Earlier registration stories (SCRUM-32/33/34 and
> the capacity/window work) still have their acceptance notes in [registrations.md](registrations.md) and
> [registration-integration.md](registration-integration.md); backfill their test cases here as they are next
> touched.

## How to run

| Command (repository root) | What it covers |
|---|---|
| `npm --prefix backend test` | Backend auth, equipment, unit and integration suites; opt-in live database tests skip unless enabled |
| `npm --prefix backend run test:cov` | Backend coverage for the story's files |
| `npm --prefix frontend test -- --run` | Frontend component/flow tests |
| `npm --prefix frontend run test:cov` | Frontend coverage |
| `npm --prefix backend run test:registration-live` | Opt-in registration-capacity live suite (`backend/tests/live/registrationCapacity.userStory.test.js`) |
| From `backend/`: `npx vitest run tests/live/waitlist.userStory.test.js` with `RUN_LIVE_WAITLIST_TESTS=true`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY` | Opt-in join-waitlist live suite (`backend/tests/live/waitlist.userStory.test.js`) |
| From `backend/`: `npx vitest run tests/live/waitlistOffers.userStory.test.js` with `RUN_LIVE_WAITLIST_OFFER_TESTS=true` and the same Supabase credentials | Opt-in released-place offer suite (`backend/tests/live/waitlistOffers.userStory.test.js`) |
| From `backend/`: `npx vitest run tests/live/waitlistCoordinator.userStory.test.js` with `RUN_LIVE_WAITLIST_COORDINATOR_TESTS=true` and the same Supabase credentials | Opt-in coordinator-control suite (`backend/tests/live/waitlistCoordinator.userStory.test.js`) |
| `npm --prefix tests/e2e test` (or, from `tests/e2e`, `npx playwright test waitlist.spec.js waitlist-offer.spec.js` for just these files) | Live browser journeys: `tests/e2e/waitlist.spec.js` (join/position/withdraw) and `tests/e2e/waitlist-offer.spec.js` (offer countdown/accept); run by CI's `playwright-live` job |

All three backend waitlist live Vitest suites are **skipped by default** — they need their respective opt-in variable plus
`SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `SUPABASE_PUBLISHABLE_KEY`. CI's `Backend Checks` job does not set these
opt-ins or all three credentials, so it runs the deterministic unit/integration coverage but skips the live DB
proof. The browser journey is *not* skipped: CI's
`playwright-live` job runs `npx playwright test` from `tests/e2e`, which matches both `waitlist.spec.js` and
`waitlist-offer.spec.js`, so the shared dev database must already have the `event_waitlist_entries` table and current
`_v2` waitlist functions.

## Waitlist test additions and updates

The following new test files were added to cover the waitlist journeys at the database/API, service, and UI layers:

| Coverage area | New test files | Why they were added |
|---|---|---|
| Join and attendee state | `backend/tests/integration/myWaitlistEntriesRoute.test.js`, `backend/tests/integration/waitlistAccessAndErrors.test.js`, `backend/tests/integration/waitlistHandlers.test.js`, `backend/tests/integration/waitlistStateRoute.test.js`, `backend/tests/unit/myWaitlistEntries.test.js`, `frontend/src/features/registrations/waitlistService.test.js`, `frontend/src/features/registrations/components/WaitlistEntry.test.jsx`, `frontend/src/features/registrations/components/WaitlistEntryPosition.test.jsx`, `frontend/src/features/registrations/components/WaitlistPanel.test.jsx` | Verify authenticated attendee ownership, join/withdraw responses, empty state and expected error handling, and display of queue status and position. |
| Availability and seat races | `backend/tests/integration/eventAvailabilityRpc.test.js`, `backend/tests/unit/registrations/registrationSeatWaitlistRace.test.js`, `backend/tests/unit/registrations/waitlistSeatReservations.test.js`, `frontend/src/features/registrations/registrationAvailability.server.test.jsx` | Cover computed availability, reserved offers and the race where ordinary registration must not take a seat owed to the waitlist. |
| Released-place offers | `backend/tests/integration/myRegistrationOffers.test.js`, `backend/tests/unit/waitlistOffersList.test.js`, `backend/tests/live/waitlistOffers.userStory.test.js`, `frontend/src/features/registrations/components/WaitlistOffer.test.jsx`, `frontend/src/features/registrations/pages/MyRegistrationsOffers.test.jsx`, `tests/e2e/waitlist-offer.spec.js` | Exercise the attendee offer list, offer states and actions, deadline and handoff behavior against Supabase, and the browser flow. Both the live backend suite and the browser journey pass (2026-10-12). |
| Coordinator controls | `backend/tests/integration/waitlistCoordinatorRoutes.test.js`, `backend/tests/unit/waitlistCoordinatorService.test.js`, `backend/tests/live/waitlistCoordinator.userStory.test.js`, `frontend/src/features/managedEvents/managedEventsWaitlistService.test.js`, `frontend/src/features/managedEvents/components/WaitlistCoordinatorPanel.test.jsx` | Verify coordinator authorization, ordered queue/settings and both manual-promotion branches (a timed offer when a seat is free, direct confirmed override when it is not) through service, API, live database and UI layers. |

These existing test files were also updated alongside the feature; the changes adapt their fixtures or assertions to the
seat-claim RPC, computed availability, and waitlist-aware attendee projection rather than removing existing coverage:

- Backend: `backend/tests/integration/registrationCapacity.test.js`, `backend/tests/integration/registrationWindow.test.js`,
  `backend/tests/integration/registrations.test.js`, `backend/tests/live/registrationCapacity.userStory.test.js`,
  `backend/tests/live/waitlist.userStory.test.js`, and `backend/tests/unit/registrations/attendeeProjection.test.js`.
- Frontend: `frontend/src/features/registrations/pages/AttendeeAccess.test.jsx`,
  `frontend/src/features/registrations/registrationAvailability.test.jsx`, and
  `frontend/src/features/registrations/registrationWindow.test.jsx`.
- Browser API fixtures: `tests/playwright/registrations.api.spec.cjs` and
  `tests/playwright/support/registration-storage.cjs`.

## Test case register — SCRUM-151 (join a waitlist when an event is full)

| Epic | Scrum-# | AC # | Type | Test Case ID | Test Scenario | Pre-conditions | Test Steps | Test Data | Expected Result | Created By* | Date of Creation* | Actual Result | Pass / Fail / Not Executed / Blocked | Remarks | Executed By | Date of Execution |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Registration | SCRUM-151 | 1 | Happy | TC-SCRUM-151-01 | Join a full event's waitlist | Approved event at capacity; signed-in attendee | 1. `POST /api/waitlist/:id` | Seeded event, 1 attendee | 201 with `position: 1` and the created entry | dev | 2026-10-09 | Passed against live Supabase | Pass | `backend/tests/live/waitlist.userStory.test.js` | local | 2026-10-12 |
| Registration | SCRUM-151 | 1 | Negative | TC-SCRUM-151-02 | A non-full event refuses a waitlist join | Approved event with a free seat | 1. `POST /api/waitlist/:id` | capacity 1, enrolled 0 | 409, no row written | dev | 2026-10-09 | Passed against live Supabase | Pass | `backend/tests/live/waitlist.userStory.test.js` | local | 2026-10-12 |
| Registration | SCRUM-151 | 1 | Negative | TC-SCRUM-151-03 | Unknown event is not found | No such event | 1. `POST /api/waitlist/<random uuid>` | random UUID | 404 | dev | 2026-10-09 | Passed against live Supabase | Pass | `backend/tests/live/waitlist.userStory.test.js` | local | 2026-10-12 |
| Registration | SCRUM-151 | 1 | Negative | TC-SCRUM-151-04 | Unapproved event refuses a waitlist join | Event status `DRAFT` | 1. `POST /api/waitlist/:id` | DRAFT event | 409, "Registration is not open…" | dev | 2026-10-09 | Passed against live Supabase | Pass | `backend/tests/live/waitlist.userStory.test.js` | local | 2026-10-12 |
| Registration | SCRUM-151 | 1 | Boundary | TC-SCRUM-151-05 | Before the registration window opens | `registration_start` in the future | 1. `POST /api/waitlist/:id` | start 2099-01-01 | 201; waitlist join is not gated by the registration window | dev | 2026-10-09 | Passed against live Supabase | Pass | `backend/tests/live/waitlist.userStory.test.js` | local | 2026-10-12 |
| Registration | SCRUM-151 | 1 | Boundary | TC-SCRUM-151-06 | After the registration window closes | `registration_end` in the past | 1. `POST /api/waitlist/:id` | end 2000-01-01 | 201; waitlist join is not gated by the registration window | dev | 2026-10-09 | Passed against live Supabase | Pass | `backend/tests/live/waitlist.userStory.test.js` | local | 2026-10-12 |
| Registration | SCRUM-151 | 1 | Conflict | TC-SCRUM-151-07 | An existing registration blocks the waitlist | Attendee already pending or confirmed | 1. `POST` with a pending row 2. repeat with confirmed 3. withdraw then `POST` | pending / confirmed / withdrawn | 409 / 409 / 201 | dev | 2026-10-09 | Passed for pending, confirmed and withdrawn cases against live Supabase | Pass | `backend/tests/live/waitlist.userStory.test.js` | local | 2026-10-12 |
| Registration | SCRUM-151 | 2 | Conflict | TC-SCRUM-151-08 | Sequential duplicate join leaves one row | Attendee already on the waitlist | 1. `POST` twice | one attendee | first 201, second 409; exactly one active row | dev | 2026-10-09 | Passed against live Supabase | Pass | `backend/tests/live/waitlist.userStory.test.js` | local | 2026-10-12 |
| Registration | SCRUM-151 | 2 | Conflict | TC-SCRUM-151-09 | Concurrent duplicate joins leave one row | Same attendee, three parallel requests | 1. `Promise.all` three `POST`s | one attendee | exactly one 201, two 409, one active row | dev | 2026-10-09 | Passed against live Supabase | Pass | `backend/tests/live/waitlist.userStory.test.js` | local | 2026-10-12 |
| Registration | SCRUM-151 | 3 | Happy | TC-SCRUM-151-10 | Position follows first-in-first-out | Three attendees join in order | 1. each `POST` 2. each `GET` | three attendees | positions `[1, 2, 3]` | dev | 2026-10-09 | Passed against live Supabase | Pass | `backend/tests/live/waitlist.userStory.test.js` | local | 2026-10-12 |
| Registration | SCRUM-151 | 3 | Happy | TC-SCRUM-151-11 | Position shifts after a withdrawal | Three on the list; first leaves | 1. `DELETE` first 2. `GET` the others | three attendees | remaining positions `[1, 2]` | dev | 2026-10-09 | Passed against live Supabase | Pass | `backend/tests/live/waitlist.userStory.test.js` | local | 2026-10-12 |
| Registration | SCRUM-151 | 3 | Boundary | TC-SCRUM-151-12 | A non-member has no position | Attendee not on the list | 1. `GET /api/waitlist/:id` | second attendee | 200 with null entry and position | dev | 2026-10-09 | Passed deterministic and live checks | Pass | `backend/tests/integration/waitlistStateRoute.test.js`; `backend/tests/live/waitlist.userStory.test.js` | local | 2026-10-12 |
| Registration | SCRUM-151 | 4 | Happy | TC-SCRUM-151-13 | Withdraw deletes the entry | Attendee on the list | 1. `DELETE /api/waitlist/:id` | one attendee | 204; the row is gone | dev | 2026-10-09 | Passed against live Supabase | Pass | `backend/tests/live/waitlist.userStory.test.js` | local | 2026-10-12 |
| Registration | SCRUM-151 | 4 | Negative | TC-SCRUM-151-14 | Repeat withdrawal is not found | Already withdrew | 1. `DELETE` again | one attendee | 404 | dev | 2026-10-09 | Passed against live Supabase | Pass | `backend/tests/live/waitlist.userStory.test.js` | local | 2026-10-12 |
| Registration | SCRUM-151 | 4 | Boundary | TC-SCRUM-151-15 | Rejoining returns to the back | A left, B stayed | 1. A `POST` 2. A `GET`, B `GET` | two attendees | A position 2, B position 1 | dev | 2026-10-09 | Passed against live Supabase | Pass | `backend/tests/live/waitlist.userStory.test.js` | local | 2026-10-12 |
| Registration | SCRUM-151 | DoD | Cross-cutting | TC-SCRUM-151-16 | No token is denied | None | 1. `POST` without `Authorization` | no token | 401 | dev | 2026-10-09 | Passed against live Supabase | Pass | `backend/tests/live/waitlist.userStory.test.js` | local | 2026-10-12 |
| Registration | SCRUM-151 | DoD | Cross-cutting | TC-SCRUM-151-17 | Wrong role is denied | Signed-in coordinator | 1. `POST` as coordinator | coordinator token | 403 | dev | 2026-10-09 | 403; no storage RPC called | Pass | `backend/tests/integration/waitlistAccessAndErrors.test.js` | local | 2026-10-12 |
| Registration | SCRUM-151 | DoD | Cross-cutting | TC-SCRUM-151-18 | A forged attendee id is ignored; another user's entry is invisible | Attendee A on the list | 1. A `POST` with B's id in the body 2. B `GET` 3. B `DELETE` | A, B tokens | the row belongs to A; B gets an empty 200 state on read and 404 on withdraw | dev | 2026-10-09 | Passed against live Supabase | Pass | `backend/tests/live/waitlist.userStory.test.js`; no other attendee data returned | local | 2026-10-12 |
| Registration | SCRUM-151 | 1 | Failure | TC-SCRUM-151-19 | Storage failure returns a safe 500 | Data client RPC errors | 1. `GET` waitlist state | injected provider failure | 500 with a generic message; provider detail is server-logged, not returned | dev | 2026-10-09 | 500 with generic response; provider error logged | Pass | `backend/tests/integration/waitlistAccessAndErrors.test.js` | local | 2026-10-12 |
| Registration | SCRUM-151 | 1,3,4 | Cross-cutting | TC-SCRUM-151-20 | Full event shows the waitlist, join and position in the browser | Full approved event; signed-in attendee | 1. open `/events/:id` 2. click *Join waitlist* | live fixture | "Event waitlist" heading; after join, "position: 1" | dev | 2026-10-09 | Passed in the live browser (2026-10-12) | Pass | Automated: `tests/e2e/waitlist.spec.js` (live browser journey) | local | 2026-10-12 |
| Registration | SCRUM-151 | 4 | Cross-cutting | TC-SCRUM-151-21 | Leave waitlist returns the Join control | Attendee on the list | 1. click *Leave waitlist* | live fixture | 204; the *Join waitlist* button returns | dev | 2026-10-09 | Passed in the live browser (2026-10-12) | Pass | Automated: `tests/e2e/waitlist.spec.js` | local | 2026-10-12 |

## AC → test traceability — SCRUM-151

| AC | Requirement | Test cases | Automated test(s) |
|---|---|---|---|
| 1 | Join the waitlist when the event is full | TC-SCRUM-151-01…07, -19, -20 | `backend/tests/live/waitlist.userStory.test.js`; `tests/e2e/waitlist.spec.js` |
| 2 | Cannot join twice | TC-SCRUM-151-08, -09 | same file |
| 3 | View waitlist position | TC-SCRUM-151-10, -11, -12, -20 | same file; `tests/e2e/waitlist.spec.js` |
| 4 | Withdraw at any time | TC-SCRUM-151-13, -14, -15, -21 | same file; `tests/e2e/waitlist.spec.js` |
| DoD | Only attendees; own entry only | TC-SCRUM-151-16, -17, -18 | Live suite (opt-in); 401 and denied-role behavior also has deterministic integration coverage |

## Coverage notes — SCRUM-151

Run `npm --prefix backend run test:cov` and `npm --prefix frontend run test:cov` and record statement/branch coverage
for:

- `backend/src/modules/registrations/waitlistService.js`
- `backend/src/modules/registrations/waitlistHandlers.js`
- `frontend/src/features/registrations/waitlistService.js`
- `frontend/src/features/registrations/components/WaitlistPanel.jsx`

Target: 100% of these files' lines and branches, or a stated reason per gap.

## Test case register — released-place offer story

The offer story's Jira key was not included in the supplied story. IDs below are descriptive until the team assigns
the Jira key.

| AC | Scenario | Expected result | Automated evidence | Latest status |
|---|---|---|---|---|
| 1 | A seat opens and an eligible attendee is next | Offer includes a bounded effective deadline; queue order is respected | `backend/tests/live/waitlistOffers.userStory.test.js`; `tests/e2e/waitlist-offer.spec.js` | Live backend passed 25/25; browser E2E passed (2026-10-12) |
| 2 | Attendee accepts before deadline | Offer becomes a registration and the seat is accounted for | Same live and E2E suites; non-live capacity/route tests | Live backend passed; browser E2E passed (2026-10-12) |
| 3 | Attendee declines or does not respond | Offer reservation is released and reconciliation advances to the next eligible attendee | Same live suite | Live backend passed; browser E2E passed (2026-10-12) |
| Cross-cutting | Caller sees only their own offers; required details and capacity conflicts are handled | Caller-scoped API data; explicit error responses | `backend/tests/integration/myRegistrationOffers.test.js`; `backend/tests/integration/waitlistHandlers.test.js`; frontend offer tests | Live backend suite passed 25/25 |

## Test case register — coordinator waitlist controls

| AC | Scenario | Expected result | Automated evidence | Latest status |
|---|---|---|---|---|
| Access | Assigned coordinator reads queue/settings; attendee, organiser, unauthenticated and unrelated coordinator are denied | Only the assigned coordinator reaches the controls | `backend/tests/integration/waitlistCoordinatorRoutes.test.js`; `backend/tests/integration/managedEvents.permissions.test.js` | Passed locally, 2026-10-12 |
| Queue | Coordinator sees ordered, paginated entries and safe display names without contact or registration data | Position/order, counts, offers and deadline are returned without PII | `backend/tests/unit/waitlistCoordinatorService.test.js`; `backend/tests/integration/waitlistCoordinatorRoutes.test.js`; `frontend/src/features/managedEvents/components/WaitlistCoordinatorPanel.test.jsx` | Passed locally, 2026-10-12 |
| Automatic offers | Setting is ON by default; OFF stops new automatic offers while existing reservations remain valid; ON resumes reconciliation | Setting and queue behavior match the database routines | `backend/tests/live/waitlistCoordinator.userStory.test.js` | Passed against live Supabase, 2026-10-12 |
| Manual promotion | Coordinator may select an eligible attendee for a timed offer when a seat is available, or use the approved direct confirmed override when no seat is available; an existing offer remains acceptable | The selected attendee receives the expected offer/registration outcome and event count is updated | `backend/tests/live/waitlistCoordinator.userStory.test.js` (manual offer + manual override); `backend/tests/integration/waitlistCoordinatorRoutes.test.js`; `backend/tests/unit/waitlistCoordinatorService.test.js` | Passed against live Supabase; suite 3/3, 2026-10-12 |
| Privacy and failure handling | Caller cannot select the actor identity; storage/Auth failures are surfaced and private attendee fields are not returned | Verified actor id is used; errors do not become success-shaped results | `backend/tests/unit/waitlistCoordinatorService.test.js`; `backend/tests/integration/waitlistCoordinatorRoutes.test.js` | Passed locally, 2026-10-12 |

## Latest local evidence (2026-10-12)

- `npm --prefix backend test`: 754 passed, 42 skipped; all 51 collected test files passed and 4 files (the opt-in live suites) were skipped (2026-10-12).
- `npm --prefix frontend test -- --run`: 405 passed across 40 files (2026-10-12).
- Root `npm run test:playwright`: 162 passed, including API and browser registration tests using the local RPC adapter.
- Backend/frontend lint, frontend production build and `git diff --check` passed. The build has the existing large-chunk warning.
- Focused non-live waitlist tests cover duplicate/not-full/missing-event outcomes, caller identity, denied roles, empty GET state and safe storage errors.
- The new waitlist service unit tests are collected by Vitest (they import `test` from Vitest rather than Node's
  separate test runner).
- The Playwright test storage adapter supplies deterministic availability and seat-claim RPC behavior; this mock
  validates route/UI integration, not the database's concurrency guarantees.
- Coordinator implementation verification: focused backend coordinator/managed-event tests passed (31 tests);
  focused frontend coordinator/managed-event tests passed (21 tests); targeted ESLint passed; frontend build passed
  with the existing large-chunk warning. The opt-in coordinator Supabase test passed (3 tests) on 2026-10-12.

## Latest live Supabase evidence (2026-10-12)

All three opt-in backend suites were run sequentially against the configured Supabase project:

| Suite | Result | Coverage |
|---|---:|---|
| `backend/tests/live/waitlist.userStory.test.js` (`RUN_LIVE_WAITLIST_TESTS=true`) | **10 passed, 0 failed** | Full/not-full join, duplicate sequential and concurrent joins, FIFO positions, withdrawal/rejoin, role and caller isolation |
| `backend/tests/live/waitlistOffers.userStory.test.js` (`RUN_LIVE_WAITLIST_OFFER_TESTS=true`) | **25 passed, 0 failed** | Offer timing, accept, decline/expiry handoff, ordering, event eligibility, capacity and concurrency cases |
| `backend/tests/live/waitlistCoordinator.userStory.test.js` (`RUN_LIVE_WAITLIST_COORDINATOR_TESTS=true`) | **3 passed, 0 failed** | Default setting, OFF/ON reconciliation, queue order, manual override while another offer is open, manual timed offer to a chosen attendee when a seat is free, organiser denial |
| `tests/e2e/waitlist.spec.js` + `tests/e2e/waitlist-offer.spec.js` (live browser) | **2 passed, 0 failed** | Attendee joins a full event, sees the position and withdraws; a waitlisted attendee sees the offer countdown and accepts the released place |

The suites create temporary Auth users and disposable events, and their cleanup hooks
attempt to remove those fixtures. No cleanup errors were reported by the join/withdrawal
or offer suites. The coordinator suite's cleanup calls completed without surfacing an
error, but that test does not assert the cleanup responses; deletion of its fixtures is
therefore not independently verified.

The committed manual-offer test creates its own disposable event, waitlist entries and
registrations and removes them in a `finally` block, so it never depends on the shared
coordinator fixture.

The live tests exercise API/database behavior. The Playwright browser journeys
(`tests/e2e/waitlist.spec.js` and `tests/e2e/waitlist-offer.spec.js`) were run and both
passed (2 tests, 2026-10-12). This pass added one committed live test (the manual timed
offer) to `backend/tests/live/waitlistCoordinator.userStory.test.js`; the other test files
were run unedited.

### Remaining coverage notes

- `WaitlistPanel.jsx` still needs dedicated loading, retry/load-error and per-action failure tests.
- The waitlist live suites remain opt-in in backend CI; the CI backend gate runs deterministic tests only.

## SCRUM-43 attendee notification checks

The existing notification worker now prepares saved registration transitions and due waitlist-offer reminders independently of assignment notifications. The exact additive history/trigger/preparation SQL and two Novu workflow configurations are documented in [notifications.md](notifications.md#attendee-registration-notifications--scrum-43).

Focused tests use `backend/tests/integration/notifications.registration.test.js`, the existing `backend/tests/unit/notifications/notificationDelivery.test.js`, `tests/playwright/registration-notifications.browser.spec.cjs`, and the disposable SQL fixtures `tests/sql/registrationNotifications.*.sql`. Run `node tests/sql/run-assignment-notifications.cjs --registration` from the root for transition/rollback/ownership/boundary/state/access checks plus two real concurrent preparation transactions. Following Ryan's 2026-10-27 schema export, the SQL fixture executes his exact promote_waitlist_entry, accept_waitlist_offer and decline_waitlist_offer bodies with explicit ancillary helper/reconciliation stubs. It enforces the supplied active/promoted and null/offered constraints, preserves the existing timestamp trigger, checks cancellation/missing-start eligibility, and adds S17-S20 for the actual RPC write order and row deletion. The automatic FIFO helper and actual Novu delivery remain outside these local fixtures; shared application/UAT still require Ryan's manual verification.

The browser cases exercise real registration/waitlist handlers, middleware, UI, inbox SDK and delivery worker against test storage. An external database offer transition is represented by a protected test-only control; the fixture is not a proof of live FIFO/coordinator promotion logic. E01 covers joining, offered promotion, accepted confirmation, recipient isolation and notification navigation. E02 covers due-reminder deduplication, spoofed recipients, unauthenticated/denied-role operations and unchanged stored offer state. Both render notification links at 375 px. E03 verifies that a cancelled_at marker or missing start_time suppresses reminders, using a valid active offer as the positive control.

Execution evidence and the four pending manual UAT cases remain outside the application repository under Ryan's local reporting preferences. Existing live test results above are historical; no shared Supabase suite was run for SCRUM-43.


### SCRUM-43 boundary/duplication audit

U05 proves a failed retry write cannot strand later claimed rows. SQL S21 retains an unsent reminder after lease expiry; S22 checks two owners in one event, stable correlation and independent reminder message/deadline values; S23 checks exact expiry and +/-1 ms, while S08/S11 cover the one-hour boundary and +/-1 ms; S24 checks the function-only repair and preserved service-only grants. SQL outcome/payload comparisons are null-safe. Browser E02 distinguishes a promoted notice's deadline from an offer-expiring reminder and checks expected text and source identity explicitly. Existing privacy, refusal and routing assertions are retained.

External audit mutation probes deliberately remove a required change type, randomise delivery identity, remove reminder text, collapse per-offer uniqueness to the event, send early, send after expiry or discard an expired lease; each must fail a specific SQL assertion. These are local one-off audit controls, not an additional application harness or package. Current execution evidence remains outside the repository. See the notification guide's audit correction for the reviewed manual function update if the earlier setup was applied.

S25 extends the audit with 101 status changes and 101 offers across the 100-row preparation boundary, asserting that no queued work is lost or recreated after successful outbox removal. All validity/outcome comparisons in the SQL assertions are null-safe. These are supporting implementation-risk checks, not new acceptance criteria.


### SCRUM-43 test-double and refactoring audit — 2026-10-28

The backend integration suite exercises the real worker and repository against a local HTTP provider and an in-memory RPC double. It proves transport, recipient selection and recovery; it does not execute Supabase transactions. Its provider now validates the configured registration payload fields, correlation IDs, nullable status deadline and application redirect path. I06 deliberately supplies five invalid payloads and requires unsent work to remain pending. I07 checks that a mismatched completion token returns false and cannot remove another claim. Claim timing, backoff and transactional guarantees remain the responsibility of the real SQL harness.

The browser storage double is independently checked in backend/tests/unit/notifications/registrationNotificationStorage.test.js. D01 checks saved event-name snapshots and status correlation; D02 checks changed-deadline retirement and one replacement; D03 uses a fixed clock for the exact reminder-window boundaries; D04 checks concurrent preparations for two simultaneous owners and refused recipient substitution. These cases correspond to the existing SQL S04/S12/S22/S08/S23 checks. They do not substitute for executing the actual SQL. The provider and storage negative controls failed against the earlier doubles before they were corrected.

Browser sign-in now waits for the authenticated account route before navigating to the event or inbox. Tests use observable readiness rather than fixed sleeps. Each browser context is closed in finally; local provider servers are closed on test completion. Boundary assertions use fake time or a fixed PostgreSQL transaction timestamp. SQL's short sleep intentionally advances beyond an already-established expiry; it is not used as an assumption that asynchronous work has completed.

The production preparation loop replaces three identical try/catch blocks while preserving their sequence, per-preparer error isolation, warning text, and claim/delivery behaviour. This is behaviour-preserving refactoring. The story's new notifications/triggers/reminder checks are feature changes; the earlier retry/lease corrections are bug fixes. Neither is described as refactoring.

Audit execution evidence stays outside the repository. Three shuffled backend runs (seeds 143, 430, 155) passed all 91 notification tests; five repetitions of E01-E03 passed 15 browser executions with three workers and retries disabled; three disposable PostgreSQL runs passed the existing assertions, repair and concurrent preparation checks. A separate before/after oracle compared 32 dependency traces. These observations provide repeatability evidence, not a guarantee against all future flakiness or a live-provider UAT pass.

The first complete audit regression run found an existing SCRUM-117 E2E-CLARIFICATION-003 assertion rejecting the substring 50 in a whole comparison panel. It failed on the timestamp 10:50 AM despite correct attendance values. The one-line correction asserts the exact definition values [30, 45], preserving the saved-baseline rule while excluding timestamp text. The original failure evidence is retained outside the repository. This is a test reliability correction, not application refactoring.
