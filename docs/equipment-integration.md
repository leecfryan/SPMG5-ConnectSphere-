# Equipment integration (PR #4)

Equipment joins the shared authentication provider, React Router, API helper and
server permission matrix. Venue pages, organiser event submission, account pages
and sign-in/session handling remain available together on frontend port 5173.

## Pages and permissions

| Page/API action | Permission and scope |
| --- | --- |
| `/equipment/requests?event=<uuid>` | `internal.access` + `equipment.request`: event coordinators |
| `/technical-support` | `internal.access` + `equipment.review`: technical support staff |
| Equipment catalogue | `equipment.read`: coordinators and technical staff |
| `GET /api/equipment/availability` | `internal.access` + `equipment.read`: coordinators and technical staff |
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

**Deferred, not built this story:** marking `equipment.status` away from
`AVAILABLE` on request approval, and any automatic revert of that status (or
`current_location`) after the event ends. The availability check above
already produces the correct "unavailable during an approved booking,
available again the day after" result dynamically from `equipment_requests`
alone, with no stored status write needed - so this remains a read-only
check. If the team still wants an explicit status write on approval (target
value undecided) plus a scheduled/triggered revert, that needs its own story.

## Database and deployment prerequisites

This branch assumes existing Supabase tables; it did not include Equipment SQL
migrations. Integration does not create or modify live tables, accounts or roles.
The existing application contracts require:

- `equipment`: `id`, `type`, `current_location`, `status` (`AVAILABLE` today;
  `IN_USE`, `MAINTENANCE`, and after the team's planned constraint update,
  `UNAVAILABLE`, `DAMAGED`, `UNDER_MAINTENANCE` - the availability check
  treats anything not `AVAILABLE` as excluded, so it works before and after
  that update).
- `equipment_requests`: `id`, `event_id`, `equipment_id`, `requested_by`,
  `quantity_requested`, `technical_requirement`, `borrow_start`, `borrow_end`,
  `status`, `created_at`; generated IDs/timestamps and appropriate foreign keys.
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
- `technical-support-review.spec.js`: dashboard review/status update and
  clarification-thread visibility using the real `coordinator.demo`/
  `technical.demo` seed accounts (requires `SEED_USER_PASSWORD` and
  `THREAD_TEST_EVENT_ID` in the root `.env`, with that event actually
  assigned to `coordinator.demo`). Its sign-in helper waits for the shared
  Sign out button because protected deep links do not visit the account page.

## Assignment and access update

Coordinator request pickers and new equipment requests require an assigned event
in `ACCEPTED` or `APPROVED` state. Technical staff retain all equipment bookings,
as agreed; a venue + technical account combines both booking workspaces.
They do not gain general event planning or attendee browsing. See
[event access](event-access.md) for manager assignment and deployment requirements.

The live availability suite supplies an accepted event in its relationship
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
