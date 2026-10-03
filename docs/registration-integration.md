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
- Withdrawal retains the record and changes its status to `withdrawn`. Confirmed,
  withdrawn, started and less-than-24-hours-away registrations are blocked. The
  browser retains the confirmation step and explains restrictions.
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

The backend uses the server-only `SUPABASE_SECRET_KEY` for data access and checks
ownership on reads and writes. Live RLS must not permit browser writes to bypass
the backend's withdrawal rules. No migrations, seed scripts, account updates or
live Supabase tests were run during integration. The existing read-then-write
withdrawal flow is retained; atomic coordination with concurrent organiser
confirmation requires database-level enforcement beyond these application tests.

## Validation

- The branch's 42 backend Registration cases and 7 React component cases remain.
  Four backend integration cases cover duplicate-query failures, unique conflicts,
  absent configuration and absence of production test controls.
- 12 API/browser cases (`REG-API-*`, `REG-E2E-*`) cover browsing, internal-field
  privacy, required data, identity/ownership, duplicate registration, status,
  withdrawal guards, sign-out, retries and protected staff routes.
- Main's Node auth/Equipment suites and Vitest event/Venue suites remain under
  `npm --prefix backend test`. Frontend tests use the existing Vitest setup.
- `npm run test:playwright` runs all feature acceptance cases with isolated local
  auth/storage adapters and the real UI/API handlers. No cloud secrets are needed.

The shared CI workflow remains intact: frontend tests/lint/build, all backend
tests/checks, Docker validation/build, and browser/API acceptance tests.
