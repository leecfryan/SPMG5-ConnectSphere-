# Equipment integration (PR #4)

Equipment joins the shared authentication provider, React Router, API helper and
server permission matrix. Venue pages, organiser event submission, account pages
and sign-in/session handling remain available together on frontend port 5173.

## Pages and permissions

| Page/API action | Permission and scope |
| --- | --- |
| `/equipment/requests?event=<uuid>` | `internal.access` + `equipment.request`: event coordinators |
| `/technical-support` | `internal.access` + `equipment.review`: technical support staff |
| Equipment catalogue page (`/equipment/catalogue`) | `equipment.review`: technical staff only (Scrum-30; coordinators no longer have a route to it) |
| `GET /api/equipment` (backend endpoint) | `equipment.read`: coordinators and technical staff - coordinators still use this indirectly via the reserve flow's own fetch |
| `GET /api/equipment/availability` | `internal.access` + `equipment.read`: coordinators and technical staff |
| Add / update / retire a catalogue record | `equipment.manage`: technical staff only (Scrum-30) |
| Restore a retired unit back to `AVAILABLE` | `equipment.review`: technical staff only (SCRUM-103) - the same quick-status endpoint used for day-to-day condition changes, since `AVAILABLE` is already one of its accepted targets |
| Assigned-event picker | Coordinators; backend filters by `events.coordinator_id` |
| Read an event's equipment requests | Technical staff across events; coordinator only for assigned events |
| Submit equipment request | Coordinator assigned to the event |
| Review all requests/change status | Technical support staff across events |
| Read/post clarification messages | Technical staff, or the event's assigned coordinator |
| Edit a message | Same event access, plus verified message authorship |

Every matched Equipment API route verifies the bearer token and requires
`internal.access` plus its action permission. Roles come from server-verified
Supabase `app_metadata.roles`, consistently with main. A legacy `user_roles`
row or client-supplied role does not grant access. Technical accounts must have
`technical_support_staff`; the storage value `messages.author_role = tech_support`
is retained for compatibility with the feature's existing database schema.

The organiser guard now applies specifically to `POST /api/events`; it no longer
blocks coordinator/technical Equipment subroutes under `/api/events/:eventId`.
The organiser submission permission itself is unchanged.

Request type, quantity, technical requirements, borrow windows, overlap rejection,
event association, dashboard enrichment, editable statuses and clarification
threads are retained. Requests start `PENDING` (Unattended); technical staff can
revise `APPROVED` (Assigned) and `REJECTED` (Issues). Threads are hidden 30 days
after event end (with the existing start-time fallback); expired thread writes
return 410. Only the verified user is saved as requester/author.

## Equipment availability check (Scrum-29)

`GET /api/equipment/availability?start=<ISO datetime>&end=<ISO datetime>&type=<string>&quantity=<int>&location=<string>`
answers "is enough suitable equipment available for this event?" Guarded the
same way as the catalogue (`internal.access` + `equipment.read`), not scoped
to one event or record - equipment catalogue access is not limited by
location per `staff-access.md`.

All five query parameters are required (AC1). `location` is accepted and
echoed back in the response but is not used to filter results yet - deferred
to a later sprint. Response shape:

```json
{
  "data": {
    "equipment_type": "PROJECTOR",
    "location": "Main Hall",
    "period": { "start": "2026-09-10T09:00:00.000Z", "end": "2026-09-10T17:00:00.000Z" },
    "available_quantity": 1,
    "requested_quantity": 2,
    "fulfillable": false,
    "available_equipment_ids": ["..."]
  }
}
```

`available_quantity` counts physical `equipment` rows of the requested
`type` that are both `AVAILABLE` (AC3 - any other status, including future
values the team's status-constraint update adds, is excluded) and not
committed to an overlapping `PENDING`/`APPROVED` request (AC2/AC4). There is
no stock/quantity column on `equipment` - each row is one physical unit, so
a single request's `quantity_requested` against one `equipment_id` does not
generalise to a multi-unit-per-type booking yet; this is a known limitation
the team is aware of and may cover in a follow-up story.

**Overlap rule changed for both this check and equipment requests.**
`equipment.service.js`'s `hasOverlappingRequest` - used by
`POST /events/:eventId/equipment-requests` - previously allowed back-to-back
bookings (touching endpoints, timestamp precision). The team decided that
divergence between the create path and this new availability check was
unacceptable, so both now share one rule (`isBlockingOverlap` in
`equipment.validation.js`): day-granularity, touching endpoints blocked
("Return Day + 1" - AC4). An item that is not equipment-request-ed away
still has its own status filter: `POST /events/:eventId/equipment-requests`
now also rejects (409) equipment that is not `AVAILABLE` (AC3), so an item
shown as unavailable through this check can never be successfully requested
through that endpoint either. The prior Rule A query is commented out in
`equipment.service.js` for reference, not deleted, in case the team revisits
this.

## Operational status changes, audit, and retire-flagging (SCRUM-103)

Every write to `equipment.status` (the quick-status `PATCH /equipment/:id/status`,
the full `PATCH /equipment/:id`, and `PATCH /equipment/:id/retire`) now also sets
`updated_by` (the server-verified caller's id, never taken from the request body)
and `updated_at`. Both columns already existed live; no schema change was needed.
This is the last change only - no history table.

Retiring equipment (the only action that sets `UNAVAILABLE`) also flags every
event with an `APPROVED` equipment request for that unit whose borrow window
covers *today* (UTC calendar day, reusing `isBlockingOverlap`'s day-truncation
rule with today passed as both the requested start and end - there is no query
window at retire time, only "now"). One `messages` row is inserted per affected
request (`author_role: "tech_support"`, `author_id` the retiring user), reaching
the event via the existing `equipment_request_id -> event_id` relationship - no
new table. `PENDING` and `REJECTED` requests are not flagged; a future-dated
`APPROVED` request (starting after today) is also not flagged - only today's
commitments are affected by an equipment going unavailable *now*. Each affected
request also moves `APPROVED` -> `REJECTED` (the same transition
`PATCH /equipment-requests/:id/status` already allows), so the Technical Support
dashboard's "Assigned" line for it reads "Issues" instead. This reuses
`messagesService`, which `equipment.routes.js` now also injects into
`createEquipmentController` alongside `equipmentService`.

The plain catalogue read (`GET /equipment`, no window) also shows an `AVAILABLE`
unit as `IN_USE` when it has an `APPROVED` request covering today - computed on
each read from the same data, never written to the row.

**Restoring a retired unit.** `AVAILABLE` was already a valid target on the
quick-status endpoint (`OPERATIONAL_STATUSES` includes it), so no backend change
was needed for Technical Support Staff to bring a retired unit back - only a
"Restore to available" control on the catalogue page's retired rows (shown once
"Show retired equipment" reveals them), calling that existing endpoint.

**Deferred, not built this story:** marking `equipment.status` away from
`AVAILABLE` on request approval, and any automatic revert of that status (or
`current_location`) after the event ends. The availability check above
already produces the correct "unavailable during an approved booking,
available again the day after" result dynamically from `equipment_requests`
alone, with no stored status write needed - so this remains a read-only
check. If the team still wants an explicit status write on approval (target
value undecided) plus a scheduled/triggered revert, that needs its own story.

## Releasing reservations on event cancellation (SCRUM-104, extended by SCRUM-148)

SCRUM-104 built the reaction, before any cancellation action existed: `equipment.service.js`'s
`releaseReservationsForCancelledEvent(eventId, actingUserId)` moves every `APPROVED` `equipment_requests` row for
that event to a new status, `RELEASED` (added to the status check constraint alongside
`PENDING`/`APPROVED`/`REJECTED`). Unlike SCRUM-103's retire-flagging, this is not scoped to "today" - a cancelled
event's future-dated `APPROVED` requests are released too, since the event will never happen. `RELEASED` is
excluded from `BLOCKING_REQUEST_STATUSES`, so the existing availability check counts the unit again immediately,
with no change to the predicate itself.

**SCRUM-148 change:** the same function now also moves every `PENDING` request on the event to `RELEASED`, not
`REJECTED`. SCRUM-104 deliberately left `PENDING` requests untouched, because nothing had decided yet whether the
event's cancellation should resolve them - that question only had an answer once a real cancel action existed. An
earlier version of this story moved `PENDING` to `REJECTED`, but `REJECTED` is Technical Support Staff's own status
for "this request can't be fulfilled" (shown as *Issues* in `EventEquipmentCard.jsx`'s status selector) - it would
have misreported why the request stopped mattering. A `PENDING` request has nothing left to serve once its event is
cancelled, same as an `APPROVED` one, so both now resolve to `RELEASED`, matching AC3's own wording ("equipment
reservations are released"). `releaseReservationsForCancelledEvent`'s return value has one combined `released`
array; there is no separate `rejected` array.

For each equipment unit that lost a reservation this way, `equipment.status` reverts `IN_USE -> AVAILABLE` only if
it is still `IN_USE` and no other active (`PENDING`/`APPROVED`) reservation still covers today - a unit a
technician has deliberately set to `DAMAGED`/`MAINTENANCE`/`UNDER_MAINTENANCE`/`UNAVAILABLE` is left alone.
`updated_by` is `null` on this write (there is no authenticated caller without a cancellation endpoint).

There are now three ways this runs:

- **The real cancel action (SCRUM-148).** `POST /api/internal/events/:eventId/cancel` calls this function
  synchronously as part of the same request, so it is true the moment cancellation is saved - see
  `docs/event-requests.md`'s *Cancelling an event* section for the action itself.
- **Equipment reads self-heal automatically**, for any event cancelled before this action existed, or cancelled
  directly in the database. `GET /equipment` and `GET /equipment/availability` both call
  `releaseCancelledEventReservations` (`equipment.controller.js`) before computing their response: it lists every
  `CANCELLED` event (`listCancelledEventIds`, a dependency alongside `findEventById`/`findEventsByIds`) and
  releases each one's reservations. Calling this on every read is safe and cheap: once an event's requests are
  `RELEASED`/`REJECTED`, re-processing it is a no-op.
- **`backend/scripts/releaseCancelledEvents.js`** does the same thing on demand, for scripting/ops use
  (`node scripts/releaseCancelledEvents.js <eventId>` or `--all`), without waiting for the next read.

## Database and deployment prerequisites

This branch assumes existing Supabase tables; it did not include Equipment SQL
migrations. Integration does not create or modify live tables, accounts or roles.
The existing application contracts require:

- `equipment`: `id`, `type`, `current_location`, `status` (`AVAILABLE` today;
  `IN_USE`, `MAINTENANCE`, and after the team's planned constraint update,
  `UNAVAILABLE`, `DAMAGED`, `UNDER_MAINTENANCE` - the availability check
  treats anything not `AVAILABLE` as excluded, so it works before and after
  that update), `updated_by`, `updated_at` (SCRUM-103 AC4 - set on every
  status-changing write, server-side only).
- `equipment_requests`: `id`, `event_id`, `equipment_id`, `requested_by`,
  `quantity_requested`, `technical_requirement`, `borrow_start`, `borrow_end`,
  `status` (`PENDING`, `APPROVED`, `REJECTED`, and `RELEASED` - SCRUM-104, added to the check constraint by hand),
  `created_at`; generated IDs/timestamps and appropriate foreign keys.
- `messages`: `id`, `equipment_request_id`, `author_id`, `author_role`, `body`,
  `created_at`, `updated_at`, `deleted_at`; the existing timestamp trigger is used
  for edits. The author-role constraint must accept `tech_support` and
  `event_coordinator`.
- `events`: the existing event schema, including `coordinator_id`, `name`,
  `start_time`, `end_time`, `status`; coordinators need actual assignments.

`SUPABASE_SECRET_KEY` is used only by the backend data services. Without data
configuration, authorised Equipment calls return 503 while sign-in still works.
The browser receives only public auth configuration and uses the shared `/api`
proxy. No additional frontend server or port is introduced.

Live schema, RLS policies and account-role configuration still require deployment
verification. Do not grant direct anonymous/browser table access that bypasses
Express. The feature's overlap check remains an application-level read-before-write
check; concurrent reservation safety requires a database constraint/transaction
in a separate schema change. No such database guarantee is claimed by these tests.

## Checks

The team moved equipment availability integration tests and dedicated equipment
Playwright workflows to the real dev Supabase project. Pure unit tests and the
cross-feature RBAC suite remain isolated from the database; this is not a
repo-wide change to live testing.

- `npm --prefix backend run test:equipment`: 64 Node tests, adapted to
  exercise the production router and canonical permissions. Stays on Node's
  `node:test` runner and fakes; a legacy holdover, not the pattern to copy for
  new equipment work.
- Scrum-29's own backend tests are Vitest: `backend/tests/unit/equipment.availability.test.js`
  (pure overlap/status/quantity logic, 16 cases, deliberately DB-free - these
  test plain functions with no I/O, so there's nothing for a live database to
  add) and `backend/tests/integration/equipment.availability.test.js` (real
  Express app + the real `createEquipmentService` against the real dev
  Supabase database - every insert/select/delete is a genuine network call,
  each test creates its own equipment/equipment_requests rows under a unique
  `type` and cleans them up in `afterEach`). Both are placed outside
  `tests/unit/equipment/` so they run under `npm --prefix backend run
  test:events` (Vitest) rather than the legacy Node glob.
- SCRUM-103's backend tests are `backend/tests/integration/equipment-status-change.test.js`
  (live-DB Vitest, same pattern as above): AC4's audit columns on both the
  quick-status PATCH and retire, the restore-to-available action, and AC3's
  retire-flagging (today-only APPROVED requests, PENDING/REJECTED excluded,
  multi-event fan-out, zero-reservation no-op). AC1/AC2 are not retested here -
  this story added no new code for either; the file's header comment points to
  the existing SCRUM-30/SCRUM-29 coverage that still proves them.
- SCRUM-104's backend tests are `backend/tests/integration/equipment-release-cancelled-event.test.js`
  (live-DB Vitest, same pattern as above, with its own throwaway events - never
  a shared demo event, since these tests set `status = CANCELLED`): releasing
  every `APPROVED` request regardless of date, `REJECTED` left untouched
  (`PENDING` is now auto-rejected too - SCRUM-148), the availability check
  counting a released unit again, a second still-active reservation still
  blocking it, the `IN_USE -> AVAILABLE` guard and its DAMAGED/still-in-use
  exceptions, re-running the release safely, a reservation-free event, a
  different active event's requests left untouched, and the read-time
  self-heal itself (cancelling an event and going straight to `GET
  /equipment/availability`, with no call to
  the release function or the script at all).
- `tests/playwright/equipment.api.spec.cjs` / `equipment.browser.spec.cjs`
  (the fake in-memory Auth+backend simulator's equipment coverage) are
  retired on staging. Their scenarios moved to `tests/e2e/` below. The small
  `tests/playwright/support/equipment-storage.cjs` adapter remains only for
  cross-feature RBAC tests, which inject isolated storage instead of writing
  synthetic identities into the live database. Its equipment is AVAILABLE
  and its overlap check uses the production Return Day + 1 rule.
- `npm --prefix backend test`: auth, Equipment Node tests, and existing Vitest
  event/Venue/equipment-availability suites (the latter now live-DB). Vitest
  excludes the legacy Node test files to avoid duplicate execution.
- Existing CI also runs frontend tests/lint/build, Docker checks and the
  `tests/playwright` browser/API acceptance suite. That suite uses local
  storage adapters and retains cross-feature equipment assignment/access
  checks; dedicated equipment workflows use the live suite below.

`tests/e2e/` is the live-Supabase Playwright suite, separate from CI because
it writes to a real development database:

- `equipment-request.spec.js`: the request page end-to-end (AC1-4), the
  Scrum-29 dropdown-filter and event-derived borrow-window behaviour, the
  catalogue page, and role-gated direct-URL access. Self-contained - creates
  its own throwaway accounts/event/equipment via `support/live-equipment-fixtures.js`
  and deletes them afterwards, so it needs no configured event/env var beyond
  `SEED_USER_PASSWORD`/Supabase credentials.
- `equipment-api.spec.js`: request creation (including that the server
  ignores forged `requested_by`/`status`), technical review authority,
  clarification-message relationships/authorship, the 30-day retention
  cutoff, and role revocation taking effect on the very next request with an
  already-issued token. Also self-contained via the same fixture helper.
  SCRUM-103 added one case: retiring equipment with a same-day `APPROVED`
  reservation flags the event's thread, proven through the real running
  backend (not a fake).
- `equipment-catalogue-manage.spec.js`: add/edit/retire through the real
  browser UI (Scrum-30). SCRUM-103 added one case: restoring a retired unit
  back to `AVAILABLE` through the catalogue page's "Restore to available"
  control, confirmed on a page reload.
- `equipment-release-cancelled-event.spec.js` (SCRUM-104): two scenarios against
  a cancelled throwaway event - running `scripts/releaseCancelledEvents.js` as a
  real child process, and cancelling the event with no script run at all, relying
  only on the next `GET /equipment`/`GET /equipment/availability` call to self-heal.
  Both confirm through the real running backend that the request reads
  `RELEASED`, the equipment reads `AVAILABLE`, and availability counts the unit
  again.
- `technical-support-review.spec.js`: dashboard review/status update and
  clarification-thread visibility using the real `coordinator.demo`/
  `technical.demo` seed accounts (requires `SEED_USER_PASSWORD` and
  `THREAD_TEST_EVENT_ID` in the root `.env`, with that event actually
  assigned to `coordinator.demo`). Its sign-in helper waits for the shared
  Sign out button because protected deep links do not visit the account page.

## Assignment and access update

Coordinator request pickers and new equipment requests require an assigned event
in `APPROVED` or `CONFIRMED` state (`PLANNING_STATUSES` in `events/lifecycle.js`). Technical staff retain all equipment bookings,
as agreed; a venue + technical account combines both booking workspaces.
They do not gain general event planning or attendee browsing. See
[event access](event-access.md) for manager assignment and deployment requirements.

The live availability suite supplies an approved event in its relationship
fixture so equipment rejection tests reach the availability checks rather than
passing on the earlier event-status rejection. Those tests assert the rejection
message as well as HTTP 409.

CI targets lowercase `staging`. Backend CI keeps the incoming live equipment
test and its Supabase secret references. It needs the existing development schema,
seed coordinator and assigned event. The conflict-resolution agent does not run
live database tests locally. For local checks without database writes, run the
auth/equipment Node suites and Vitest with
`npm --prefix backend run test:events -- --exclude tests/integration/equipment.availability.test.js`.
This explicitly leaves the live integration suite unverified locally; it is not
a replacement for its CI result or the manual live Playwright run.
