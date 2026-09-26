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

## Database and deployment prerequisites

This branch assumes existing Supabase tables; it did not include Equipment SQL
migrations. Integration does not create or modify live tables, accounts or roles.
The existing application contracts require:

- `equipment`: `id`, `type`, `current_location`.
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

- `npm --prefix backend run test:equipment`: original 63 Node tests, adapted to
  exercise the production router and canonical permissions.
- `npm run test:playwright -- tests/playwright/equipment.api.spec.cjs tests/playwright/equipment.browser.spec.cjs`:
  17 API/browser integration cases (IDs `EQUIPMENT-API-*`, `EQUIPMENT-E2E-*`).
  These use the real Express routes and React UI with isolated in-memory auth/data
  services; no live Supabase credentials or writes.
- `npm --prefix backend test`: auth, Equipment Node tests, and existing Vitest
  event/Venue suites. Vitest excludes Node test files to avoid duplicate execution.
- Existing CI also runs frontend tests/lint/build, Docker checks and the entire
  browser/API acceptance suite.

The optional `tests/e2e` package contains the Equipment branch's manual live
Supabase tests. It is separate from CI because it creates requests/messages and
changes statuses in a real development database. It now follows the routed pages
and requires `SEED_USER_PASSWORD`, `EQUIPMENT_TEST_EVENT_ID` and
`THREAD_TEST_EVENT_ID` explicitly, with correctly assigned events and trusted
account roles. Those tests are not run as part of conflict resolution.

## Assignment and access update

Coordinator request pickers and new equipment requests require an assigned event
in `ACCEPTED` or `APPROVED` state. Technical staff retain all equipment bookings,
as agreed; a venue + technical account combines both booking workspaces.
They do not gain general event planning or attendee browsing. See
[event access](event-access.md) for manager assignment and deployment requirements.
