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

- Existing Registration cases remain unchanged. The new capacity integration
  suite covers seat claims, full/busy responses, CAS races, insert rollback,
  duplicate checks, null semantics and pending-withdrawal decrements. New
  managed-event UI tests cover registration/cap display and the Full state.
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
