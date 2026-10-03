# Registration integration (PR #5)

Registration uses main's single React Router, `AuthProvider`, verified identity
and API transport. Sign-in, account pages, organiser event submission, Venue and
Equipment remain in the same app. No additional frontend server or port is needed.

| URL | Purpose |
| --- | --- |
| `/events` | Browse approved events |
| `/events/:eventId` | Event information and dynamic registration form |
| `/registrations/me` | Signed-in user's registration history and status |
| `/registrations/me/:registrationId` | Own submitted details and eligible withdrawal |

All four pages require the shared verified session. As on the Registration branch,
any authenticated account may participate using its own identity; this does not
grant staff permissions or access to another attendee's records. Internal pages
still require main's existing permissions. The static `/events/new` organiser
route takes precedence over `/events/:eventId` and retains `events.submit`.

## Preserved behavior and integration corrections

- The server lists/details only `APPROVED` events; the browser cannot select a
  different status filter. Event reads expose attendee-facing fields, excluding
  organiser/coordinator identities, internal comments and planning requirements.
  The original list/detail response shapes remain unchanged. Registration
  windows and the server clock are loaded from the separate
  `/api/events/registration-windows` and
  `/api/events/registration-windows/:eventId` endpoints.
- Dynamic registration fields, required-field validation, duplicate rejection,
  pending status, ownership, submitted details and registration history remain.
  Requester identity and initial status cannot be overridden through the body.
- `events.enrolled_attendees` is claimed with a guarded compare-and-set before
  registration insert. `events.expected_attendance` is the hard cap for this
  feature; null means unlimited and zero means full. Capacity conflicts return
  409. The app retries concurrent claim conflicts up to three times and returns
  a retryable busy response if contention continues. Pending and confirmed rows
  occupy seats; withdrawn rows do not. Event browsing and the registration
  detail page show remaining slots based on the event count/cap snapshot returned
  by the API; the registration endpoint remains authoritative if that snapshot
  becomes stale.
- Withdrawal retains the record and changes its status to `withdrawn`. Confirmed,
  withdrawn, started and less-than-24-hours-away registrations are blocked. The
  browser retains the confirmation step and explains restrictions. Withdrawing
  a pending registration also attempts a guarded seat decrement; a counter
  update failure is logged without failing the completed withdrawal.
- No waitlist is implemented. A full event is refused with a message explaining
  that waiting-list redirection is pending; no redirect or waitlist entry occurs.
- Registration windows are checked with backend server time after event status
  and required-field checks but before duplicate lookup and capacity claim. Both
  boundaries are inclusive (`registration_start <= now <= registration_end`).
  A request before the start returns 409 with the opening time; a request after
  the end returns 409 with a closed message. Neither refusal claims a seat nor
  inserts a registration.
- A null `registration_start` means registration is open immediately; a null
  `registration_end` means there is no closing instant. Both null preserve the
  previous behavior. Attendee pages show the window in browser-local time and
  use the API's server time to estimate the countdown. The opening transition
  re-requests server time and keeps registration disabled until the server
  confirms it is open. This UI is informational; the POST check remains
  authoritative.
- Event Organisers and Event Coordinators can set or change only the window on
  events they own/manage through
  `PATCH /api/managed-events/:eventId/registration-window`. The patch accepts
  either or both fields; omitted fields retain their stored values and null
  clears a boundary. A shared validator checks the resulting pair and requires
  a non-null end to be later than a non-null start. Past dates are allowed so a
  closed window can be extended. An end after the event starts shows a warning
  but is allowed; changes do not alter existing registrations.
- Non-text structured registration values are rejected to prevent malformed
  details from crashing the React detail view. Failed duplicate lookups fail
  closed; database unique violations return a safe 409 duplicate response.
- Route/session changes hide old data; registration detail state resets between
  records. Retry clears prior errors, and leaving the event page cancels the
  delayed post-registration navigation.
- GET event browsing coexists with organiser POST event submission and Equipment
  event subroutes. Registration owns neither the shared auth shell nor main's
  capability response.
- Production does not mount `/api/test/control`, even with `PW_CONTROL_KEY` set.
  Browser tests create isolated fixture accounts and data in `tests/playwright`
  rather than deleting registrations in a live database. Both original browser
  scenarios (register and withdraw) are retained in that combined suite.
- Missing data configuration returns 503 after authentication, without preventing
  sign-in or other configured modules from working.

## Database prerequisites and limits

The feature assumes the existing `events.registration_fields` column, approved
event status, and `registrations` table documented in `registrations.md`. This PR
does not include Registration SQL migrations; the repository's current migrations
cover Venue. Existing database configuration must be verified for deployment.

The project owner added these two columns manually in the Supabase dashboard.
There is no migration file for them. Anyone setting up another environment must
add the columns manually before deploying this code:

```text
registration_start — timestamptz, nullable — earliest instant attendees may register; stored as a UTC instant.
registration_end   — timestamptz, nullable — latest inclusive instant attendees may register; stored as a UTC instant.
```

The Event Organiser form accepts these optional values on `POST /api/events`.
The managed-event window endpoint accepts partial updates; invalid timestamps
or an end not later than the effective start return 400 with field details.
Non-permitted or unrelated users receive 403. Attendee window refusals return
409 Conflict: `Registration has not opened yet. It opens on <ISO UTC date>.`
or `Registration has closed.` Coordinator inputs are interpreted in the
coordinator's browser timezone and converted to ISO UTC before saving; attendees
see local date/time with a timezone abbreviation. Countdown revalidation makes
at most four server-time requests (immediate, then 250, 500 and 1000 ms delays)
per opening transition; if they do not confirm opening, the attendee can
manually request another check.

The managed-event registration summary retains its existing response shape.
Its separate `GET /api/managed-events/:eventId/registration-window` endpoint
returns the two window fields and `server_time`. The attendee window endpoints
likewise return a separate `{ windows, server_time }` or `{ window,
server_time }` payload. The existing event-list/detail payloads are unchanged.

The seed script deliberately omits both columns from its event upserts. New rows
therefore use the nullable database default (`null`), while reseeding does not
overwrite a window already configured on an existing demo event.

The codebase has no generated Supabase TypeScript database-types file; the
frontend and backend use JavaScript. The attendee and managed-event APIs use
explicit column lists and response serializers, and those lists/shapes include
both window fields. The event repository's internal `findById`,
`findByIds` and `findSubmittedUnassigned` helpers use `select("*")`, so they
already read the new columns without a query change.

Registration rows need generated UUIDs/timestamps, event/user foreign keys,
`registration_data`, status values `pending`, `confirmed`, `withdrawn`, and a
unique constraint on `(attendee_id, event_id)` for concurrent duplicate protection.
The retained seed script already relies on that unique constraint.

The capacity flow also relies on writable `events.enrolled_attendees` and
`events.expected_attendance` columns. The app uses normal server-side Supabase
queries and does not add a function, trigger or migration. Counter claims,
insert and withdrawal are not one database transaction; a server crash or
failed guarded rollback/decrement can leave the count out of sync with active
registrations. Reconcile by comparing the counter with `pending` plus
`confirmed` registrations for each event, then correct the event counter through
an authorized administrative process.

The backend uses the server-only `SUPABASE_SECRET_KEY` for data access and checks
ownership on reads and writes. Live RLS must not permit browser writes to bypass
the backend's withdrawal rules. Registration seat claims and releases are
application-level compare-and-set updates; withdrawal also changes status
conditionally on the status originally read. These steps are not a database
transaction, and atomic coordination with concurrent organiser confirmation
requires database-level enforcement beyond these application tests.

## Validation

- Existing Registration behavior remains covered. The new capacity integration
  suite covers seat claims, full/busy responses, CAS races, insert rollback,
  duplicate checks, null semantics and pending-withdrawal decrements. New
  managed-event UI tests cover registration/cap display and the Full state.
  Registration-window tests cover window boundaries, denied writes, partial
  extension, disabled attendee states, server-time confirmation, and timer
  cleanup. A few exact response/select assertions were updated for the
  intentionally additive API fields.
- 12 API/browser cases (`REG-API-*`, `REG-E2E-*`) cover browsing, internal-field
  privacy, required data, identity/ownership, duplicate registration, status,
  withdrawal guards, sign-out, retries and protected staff routes.
- Main's Node auth/Equipment suites and Vitest event/Venue suites remain under
  `npm --prefix backend test`. Frontend tests use the existing Vitest setup.
- `npm run test:playwright` runs all feature acceptance cases with isolated local
  auth/storage adapters and the real UI/API handlers. No cloud secrets are needed.
- `npm --prefix backend run test:registration-live` runs the opt-in live
  registration capacity suite. Set `RUN_LIVE_REGISTRATION_CAPACITY_TESTS=true`,
  `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`, and
  `SEED_USER_PASSWORD` in the root `.env`; the seeded organiser and two attendee
  accounts must exist. The suite starts the real backend with a server-side
  secret-key client, creates a uniquely identified temporary approved event,
  tests real event reads, registration, capacity refusal, parallel last-seat
  requests and withdrawal, then deletes only registrations and the event with
  that generated test ID. It does not alter seeded events or accounts. Live
  database writes occur only when this explicit opt-in variable is enabled.

The shared CI workflow remains intact: frontend tests/lint/build, all backend
tests/checks, Docker validation/build, and browser/API acceptance tests.
