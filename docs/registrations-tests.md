# Registration test guide

Deliverable 3 for the Registration lane: the standard test case register, the AC → test traceability, coverage notes
and the commands that produce the evidence. The task notes in
[`.agent/docs/other/`](../../.agent/docs/other/) hold the per-story draft; this file is the durable copy.

> Status: this guide starts with the waitlist story (SCRUM-151). Earlier registration stories (SCRUM-32/33/34 and
> the capacity/window work) still have their acceptance notes in [registrations.md](registrations.md) and
> [registration-integration.md](registration-integration.md); backfill their test cases here as they are next
> touched.

## How to run

| Command (repository root) | What it covers |
|---|---|
| `npm --prefix backend test` | Backend unit + integration + the live suites that are collected but skipped without opt-in |
| `npm --prefix backend run test:cov` | Backend coverage for the story's files |
| `npm --prefix frontend test -- --run` | Frontend component/flow tests |
| `npm --prefix frontend run test:cov` | Frontend coverage |
| `npm --prefix backend run test:registration-live` | Opt-in registration-capacity live suite (`backend/tests/live/registrationCapacity.userStory.test.js`) |
| From `backend/`: `npx vitest run tests/live/waitlist.userStory.test.js` with `RUN_LIVE_WAITLIST_TESTS=true`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY` | Opt-in waitlist live suite (`backend/tests/live/waitlist.userStory.test.js`) |
| `npm --prefix tests/e2e test` (or, from `tests/e2e`, `npx playwright test waitlist.spec.js` for just this file) | Live browser journey (`tests/e2e/waitlist.spec.js`); run by CI's `playwright-live` job |

The waitlist live Vitest suite is **skipped by default** — it needs `RUN_LIVE_WAITLIST_TESTS=true` plus
`SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `SUPABASE_PUBLISHABLE_KEY`. CI's `Backend Checks` job sets only the URL
and secret key and not the opt-in, so this suite skips there. The browser journey is *not* skipped: CI's
`playwright-live` job runs `npx playwright test` from `tests/e2e`, which matches `waitlist.spec.js`, so the shared
dev database must already have the `event_waitlist_entries` table and `enqueue_waitlist_if_full` function.

## Test case register — SCRUM-151 (join a waitlist when an event is full)

| Epic | Scrum-# | AC # | Type | Test Case ID | Test Scenario | Pre-conditions | Test Steps | Test Data | Expected Result | Created By* | Date of Creation* | Actual Result | Pass / Fail / Not Executed / Blocked | Remarks | Executed By | Date of Execution |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Registration | SCRUM-151 | 1 | Happy | TC-SCRUM-151-01 | Join a full event's waitlist | Approved event at capacity; signed-in attendee | 1. `POST /api/waitlist/:id` | Seeded event, 1 attendee | 201 with `position: 1` and the created entry | dev | 2026-10-09 | | Not Executed | Automated: `tests/live/waitlist.userStory.test.js` "AC1: full event joins successfully…" | | |
| Registration | SCRUM-151 | 1 | Negative | TC-SCRUM-151-02 | A non-full event refuses a waitlist join | Approved event with a free seat | 1. `POST /api/waitlist/:id` | capacity 1, enrolled 0 | 409, no row written | dev | 2026-10-09 | | Not Executed | Automated: same file, AC1 | | |
| Registration | SCRUM-151 | 1 | Negative | TC-SCRUM-151-03 | Unknown event is not found | No such event | 1. `POST /api/waitlist/<random uuid>` | random UUID | 404 | dev | 2026-10-09 | | Not Executed | Automated: same file, AC1 | | |
| Registration | SCRUM-151 | 1 | Negative | TC-SCRUM-151-04 | Unapproved event refuses a waitlist join | Event status `DRAFT` | 1. `POST /api/waitlist/:id` | DRAFT event | 409, "Registration is not open…" | dev | 2026-10-09 | | Not Executed | Automated: same file, AC1 `test.each` | | |
| Registration | SCRUM-151 | 1 | Boundary | TC-SCRUM-151-05 | Before the window opens | `registration_start` in the future | 1. `POST /api/waitlist/:id` | start 2099-01-01 | 409, "has not opened yet" | dev | 2026-10-09 | | Not Executed | Automated: same file, AC1 `test.each` | | |
| Registration | SCRUM-151 | 1 | Boundary | TC-SCRUM-151-06 | After the window closes | `registration_end` in the past | 1. `POST /api/waitlist/:id` | end 2000-01-01 | 409, "Registration has closed." | dev | 2026-10-09 | | Not Executed | Automated: same file, AC1 `test.each` | | |
| Registration | SCRUM-151 | 1 | Conflict | TC-SCRUM-151-07 | An existing registration blocks the waitlist | Attendee already pending or confirmed | 1. `POST` with a pending row 2. repeat with confirmed 3. withdraw then `POST` | pending / confirmed / withdrawn | 409 / 409 / 201 | dev | 2026-10-09 | | Not Executed | Automated: same file, AC1 `test.each` | | |
| Registration | SCRUM-151 | 2 | Conflict | TC-SCRUM-151-08 | Sequential duplicate join leaves one row | Attendee already on the waitlist | 1. `POST` twice | one attendee | first 201, second 409; exactly one active row | dev | 2026-10-09 | | Not Executed | Automated: same file, "AC2: sequential and concurrent…" | | |
| Registration | SCRUM-151 | 2 | Conflict | TC-SCRUM-151-09 | Concurrent duplicate joins leave one row | Same attendee, three parallel requests | 1. `Promise.all` three `POST`s | one attendee | exactly one 201, two 409, one active row | dev | 2026-10-09 | | Not Executed | Automated: same file, AC2 | | |
| Registration | SCRUM-151 | 3 | Happy | TC-SCRUM-151-10 | Position follows first-in-first-out | Three attendees join in order | 1. each `POST` 2. each `GET` | three attendees | positions `[1, 2, 3]` | dev | 2026-10-09 | | Not Executed | Automated: same file, "AC3: position follows FIFO…" | | |
| Registration | SCRUM-151 | 3 | Happy | TC-SCRUM-151-11 | Position shifts after a withdrawal | Three on the list; first leaves | 1. `DELETE` first 2. `GET` the others | three attendees | remaining positions `[1, 2]` | dev | 2026-10-09 | | Not Executed | Automated: same file, AC3 | | |
| Registration | SCRUM-151 | 3 | Negative | TC-SCRUM-151-12 | A non-member has no position | Attendee not on the list | 1. `GET /api/waitlist/:id` | second attendee | 404 | dev | 2026-10-09 | | Not Executed | Automated: same file, AC3 | | |
| Registration | SCRUM-151 | 4 | Happy | TC-SCRUM-151-13 | Withdraw deletes the entry | Attendee on the list | 1. `DELETE /api/waitlist/:id` | one attendee | 204; the row is gone | dev | 2026-10-09 | | Not Executed | Automated: same file, "AC4: withdrawal deletes…" | | |
| Registration | SCRUM-151 | 4 | Negative | TC-SCRUM-151-14 | Repeat withdrawal is not found | Already withdrew | 1. `DELETE` again | one attendee | 404 | dev | 2026-10-09 | | Not Executed | Automated: same file, AC4 | | |
| Registration | SCRUM-151 | 4 | Boundary | TC-SCRUM-151-15 | Rejoining returns to the back | A left, B stayed | 1. A `POST` 2. A `GET`, B `GET` | two attendees | A position 2, B position 1 | dev | 2026-10-09 | | Not Executed | Automated: same file, AC4 | | |
| Registration | SCRUM-151 | DoD | Cross-cutting | TC-SCRUM-151-16 | No token is denied | None | 1. `POST` without `Authorization` | no token | 401 | dev | 2026-10-09 | | Not Executed | Automated: same file, "Auth: unauthenticated…" | | |
| Registration | SCRUM-151 | DoD | Cross-cutting | TC-SCRUM-151-17 | Wrong role is denied | Signed-in coordinator | 1. `POST` as coordinator | coordinator token | 403 | dev | 2026-10-09 | | Not Executed | Automated: same file, Auth | | |
| Registration | SCRUM-151 | DoD | Cross-cutting | TC-SCRUM-151-18 | A forged attendee id is ignored; another user's entry is invisible | Attendee A on the list | 1. A `POST` with B's id in the body 2. B `GET` 3. B `DELETE` | A, B tokens | the row belongs to A; B gets 404 on read and withdraw | dev | 2026-10-09 | | Not Executed | Automated: same file, Auth | | |
| Registration | SCRUM-151 | 1 | Failure | TC-SCRUM-151-19 | Storage failure returns a safe 500 | Data client errors on insert | 1. `POST` | injected failure | 500 with a generic message, no provider detail, no row | dev | 2026-10-09 | | Not Executed | **Gap** — handler `sendStorageError` path has no automated test. Add a fake-client integration test. | | |
| Registration | SCRUM-151 | 1,3,4 | Cross-cutting | TC-SCRUM-151-20 | Full event shows the waitlist, join and position in the browser | Full approved event; signed-in attendee | 1. open `/events/:id` 2. click *Join waitlist* | live fixture | "Event waitlist" heading; after join, "position: 1" | dev | 2026-10-09 | | Not Executed | Automated: `tests/e2e/waitlist.spec.js` (live e2e) | | |
| Registration | SCRUM-151 | 4 | Cross-cutting | TC-SCRUM-151-21 | Leave waitlist returns the Join control | Attendee on the list | 1. click *Leave waitlist* | live fixture | 204; the *Join waitlist* button returns | dev | 2026-10-09 | | Not Executed | Automated: `tests/e2e/waitlist.spec.js` | | |

## AC → test traceability — SCRUM-151

| AC | Requirement | Test cases | Automated test(s) |
|---|---|---|---|
| 1 | Join the waitlist when the event is full | TC-SCRUM-151-01…07, -19, -20 | `backend/tests/live/waitlist.userStory.test.js`; `tests/e2e/waitlist.spec.js` |
| 2 | Cannot join twice | TC-SCRUM-151-08, -09 | same file |
| 3 | View waitlist position | TC-SCRUM-151-10, -11, -12, -20 | same file; `tests/e2e/waitlist.spec.js` |
| 4 | Withdraw at any time | TC-SCRUM-151-13, -14, -15, -21 | same file; `tests/e2e/waitlist.spec.js` |
| DoD | Only attendees; own entry only | TC-SCRUM-151-16, -17, -18 | same file |

## Coverage notes — SCRUM-151

Run `npm --prefix backend run test:cov` and `npm --prefix frontend run test:cov` and record statement/branch coverage
for:

- `backend/src/modules/registrations/waitlistService.js`
- `backend/src/modules/registrations/waitlistHandlers.js`
- `frontend/src/features/registrations/waitlistService.js`
- `frontend/src/features/registrations/components/WaitlistPanel.jsx`

Target: 100% of these files' lines and branches, or a stated reason per gap.

### Known gaps

- The `sendStorageError` 500 path in `waitlistHandlers.js` (TC-SCRUM-151-19) is not covered.
- `WaitlistPanel.jsx`'s loading, load-error/retry and per-action error branches have no component test; only the
  page-level "Event waitlist heading exists" assertion in
  `frontend/src/features/registrations/registrationAvailability.test.jsx` and `registrationWindow.test.jsx`.
- The live waitlist suite is opt-in and skips in CI's `Backend Checks`; run it locally with
  `RUN_LIVE_WAITLIST_TESTS=true`.
