# Current access update

Attendee responsibility is required for browsing and registration. The role
contract in [event access](event-access.md) supersedes older references below to
access for any signed-in user. The manager's "open registration" action was
removed; when registration opens is set by the registration start time.

# Attendee Registration — Sprint 1 scope

## Scrum tickets

| ID | User story |
| --- | --- |
| Scrum-32 | As an Attendee, I want to register for an event where registration is enabled so that I can participate in the event. |
| Scrum-33 | As an Attendee, I want to view my registration status so that I know the current state of my participation in an event. |
| Scrum-34 | As a registered Attendee, I want to withdraw my registration where permitted so that my registration accurately reflects that I will no longer attend. |

### Scrum-32 — Register for an event

- An Attendee can access appropriate event information for events that are open for registration.
- When registration is enabled for the event, the Attendee can submit a registration.
- A successful registration remains associated with the Attendee and the event.
- The exact registration information collected may be proposed based on the event's needs.

### Scrum-33 — View own registration status

- The Attendee can view the status of their own event registration.
- The Attendee cannot use this function to view another attendee's private registration information.
- The Attendee can also access their own upcoming registrations where appropriate.

### Scrum-34 — Withdraw event registration

- An Attendee can withdraw an existing registration where withdrawal is permitted.
- After withdrawal, the registration status reflects the change.
- The withdrawn registration remains associated with the event record as appropriate rather than appearing as an active registration.

---

## Sprint 1 daily log

Sprint duration: 2 weeks (10 working days). Today is Day 5.

---

**Day 1**
1. NA
2. Starting on Scrum-32: accessing event info and event registration.
3. NA

---

**Day 2**
1. Started on Scrum-32: set up registrations table on Supabase with RLS policies.
2. Continue on backend routing for Scrum-32.
3. NA

---

**Day 3**
1. Scrum-32–34: backend routes implemented (events list/detail, registration submit, list own, view one, withdraw).
2. Scrum-32–34: write integration tests for backend.
3. NA

---

**Day 4**
1. Scrum-32–34: finished writing backend tests and working on frontend UI for registration.
2. Scrum-32–34: finish frontend UI for registration and test with data.
3. NA

---

**Day 5 (today — 2026-09-12)**
1. Scrum-32: finished frontend UI for event list and event detail — dynamic registration form (driven by the event's `registration_fields`, server-side required field validation). Seeded data and successfully tested for events opened for registration.
2. Scrum-33: frontend UI for My Registrations page and registration detail page.
3. NA

---

**Day 6 (planned)**
1. Scrum-33: My Registrations and registration detail page UI done (submitted field values displayed, status badge, dates).
2. Scrum-34: frontend UI for withdrawal — withdraw button with confirmation, withdrawal guards (confirmed status, event already started, 24-hour cutoff) surfaced as plain-text message.
3. NA

---

**Day 7 (planned)**
1. Scrum-34: withdrawal UI and guards done.
2. Scrum-32–34: E2E testing with live Supabase data — all three tickets, edge cases (duplicate registration, withdrawal guard messages, privacy check).
3. NA

---

**Day 8 (planned)**
1. Scrum-32–34: E2E testing done.
2. Error states and polish — test with backend stopped and expired token, mobile viewport walkthrough.
3. NA

---

**Day 9 (planned)**
1. Error states and polish done.
2. Run `npm --prefix frontend run lint`, `npm --prefix frontend run build`, `npm --prefix backend test`. Final check against acceptance criteria. Rebase onto latest `main` and open PR.
3. `main` must be up to date before rebasing.

---

**Day 10 (planned)**
1. All checks clean, PR open.
2. NA
3. NA

---

## Database

One `registrations` table is needed. Suggested columns:

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid, PK | |
| event_id | uuid, FK → events | |
| attendee_id | uuid, FK → auth.users | |
| status | text | `pending`, `confirmed`, `withdrawn` |
| registration_data | jsonb | flexible fields per event's needs |
| created_at | timestamptz | |
| updated_at | timestamptz | |

RLS policies required before exposing via API:
- An attendee can read only their own rows (`attendee_id = auth.uid()`).
- An attendee can insert a row where `attendee_id = auth.uid()`.
- An attendee can update status to `withdrawn` on their own rows only.
- No attendee can read another attendee's row.

Registration schema changes were made in the shared database; this branch contains no Registration migration files. See [Registration integration](registration-integration.md) for deployment prerequisites and verification limits.

---

## Backend

New module at `backend/src/modules/registrations/`.

### Routes

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | /api/events | requireAuth + events.browse | List events open for registration (`status = APPROVED`) |
| GET | /api/events/:eventId | requireAuth + events.browse | Single event detail (APPROVED only) |
| POST | /api/registrations | requireAuth | Submit a registration for an event |
| GET | /api/registrations/me | requireAuth | All of the signed-in attendee's registrations |
| GET | /api/registrations/me/:registrationId | requireAuth | Single registration status |
| PATCH | /api/registrations/:registrationId/withdraw | requireAuth | Withdraw a registration |

### Rules enforced server-side

- POST: reject if event `status !== APPROVED`. Reject duplicate registration for the same attendee + event. Validate required fields from `registration_fields` — missing or blank required fields return 400 with the field's label. Claim a seat by compare-and-set on `events.enrolled_attendees` against `events.expected_attendance` before inserting. Expected attendance is the hard cap for registration; null is unlimited and zero is full. Full events return 409; contention retries three times before returning a retryable busy response.
- PATCH withdraw: verify the row belongs to `req.user.id`. Reject if already withdrawn. Reject if `status = confirmed` (organiser has locked it). Reject if the event has already started. Reject if the event starts within 24 hours.
- A successful withdrawal of a pending registration attempts a guarded decrement of `events.enrolled_attendees`. A failed decrement is logged and does not undo the withdrawal.
- Pending and confirmed registrations occupy seats; new registrations begin as pending. Confirmed registrations remain non-withdrawable under the existing rule.
- A full event can be joined through the separate waitlist instead of being refused (SCRUM-151). See
  *Waitlist (SCRUM-151)* below for the endpoints and rules. Registration itself is unchanged: a full event still
  returns 409 from `POST /api/registrations`.
- The approved-event list and event detail API include `enrolled_attendees` and `expected_attendance`; the browser displays remaining slots and marks full events. This is an informational snapshot, not a guarantee that a slot remains available until submission.
- GET /me routes: always filter by `attendee_id = req.user.id` — never trust a client-supplied attendee ID.

---

## Frontend

New feature folder at `frontend/src/features/registrations/`.

### Pages

| File | Route | Scrum | Description |
| --- | --- | --- | --- |
| `pages/EventListPage.jsx` | /events | 32 | Lists events open for registration |
| `pages/EventDetailPage.jsx` | /events/:eventId | 32 | Event info, all venue bookings + registration form |
| `pages/MyRegistrationsPage.jsx` | /registrations/me | 33 | Attendee's registrations + statuses |
| `pages/RegistrationDetailPage.jsx` | /registrations/me/:registrationId | 33, 34 | Single registration status + withdraw |

### Components

| File | Used by | Description |
| --- | --- | --- |
| `components/RegistrationForm.jsx` | EventDetailPage | Form driven by the event's `registration_fields` array — renders one input per field, respects `required`, `label`, and `type`. No fields = submit-only form. |
| `components/RegistrationStatusBadge.jsx` | MyRegistrationsPage, RegistrationDetailPage | Displays `pending` / `confirmed` / `withdrawn` |
| `components/WithdrawButton.jsx` | RegistrationDetailPage | Withdraw action with confirmation step. Only rendered when withdrawal is permitted; replaced by an explanatory note otherwise. |
| `components/RegistrationCard.jsx` | MyRegistrationsPage | Summary card showing event name, date, status |
| `components/WaitlistPanel.jsx` | EventDetailPage | SCRUM-151. Shown when the event is full: joins the waitlist, shows the caller's position, and withdraws. Handles loading, load-error/retry and per-action errors, with "Checking your waitlist position…", "Your waitlist position: N" and "Leave waitlist" copy. |

### Hooks

| File | Description |
| --- | --- |
| `hooks/useRegistrations.js` | Fetch the attendee's own registrations |
| `hooks/useEventRegistration.js` | Submit registration, withdraw, track loading/error state |

---

## Acceptance criteria

| Scrum | Done when |
| --- | --- |
| 32 | Signed-in attendee can submit a registration for an APPROVED event. Form fields match the event's `registration_fields` definition. Required fields are validated both client-side (HTML `required`) and server-side. Duplicate submissions are rejected. Registration is persisted linked to the attendee and event. Non-APPROVED events are not accessible. |
| 33 | Attendee can see all their own registrations with event name and current status. Single registration detail shows status, submitted field values, and date. Cannot access another attendee's registration via URL. |
| 34 | Attendee can withdraw an eligible registration. Status updates to `withdrawn`. The record is retained (not deleted). Withdrawn registrations no longer appear as active. Withdrawal is blocked (with a message) if: registration is confirmed, event has started, or event starts within 24 hours. |
| 151 | When an event is full, an attendee can join its waitlist. An attendee cannot join the same waitlist twice. The attendee can view their own position and withdraw at any time. See [Registration test guide](registrations-tests.md) for the cases. |

---

## Original branch status (2026-09-12, Day 5; historical)

### Done

- Backend routes: all implemented and live.
- Backend integration tests: written and passing.
- Dynamic registration fields: form renders from `registration_fields` per event; server validates required fields.
- Withdrawal guards: confirmed status, event already started, 24-hour cutoff — enforced on server, surfaced to user in UI.
- Registration detail: submitted field values displayed.
- Seed data: 8 events with varied `registration_fields` (`backend/scripts/seedData.js`).

### Remaining

- E2E testing with live Supabase data (today).
- Error-state and mobile polish, lint + build, PR (Day 6).

### Current blockers

- E2E testing requires events seeded in Supabase. Run `node backend/scripts/seedData.js` if not done. Need a valid attendee bearer token (sign in via the app).

## Integration update — 2026-09-20

The Registration feature now shares main's router, session provider and API transport. Original registration/withdrawal scenarios are included in the isolated combined browser suite; production deletion controls were removed. See [Registration integration](registration-integration.md) for current behavior, validation and database prerequisites. Live Supabase verification remains outstanding.

## Capacity and live verification

`events.expected_attendance` is the hard registration cap and
`events.enrolled_attendees` is the application-maintained seat counter. The
server claims seats with a guarded compare-and-set before inserting a
registration, retries contention up to three times, refuses a full event with
409, and attempts a guarded rollback if insertion fails. A null cap means
unlimited; a zero cap is full. Browsing and event details expose the counter and
cap so attendees can see remaining slots. Pending and confirmed rows occupy
seats; a successful pending withdrawal attempts to release one.

Run the opt-in live acceptance suite with
`npm --prefix backend run test:registration-live`. It requires the
`RUN_LIVE_REGISTRATION_CAPACITY_TESTS=true` opt-in, Supabase URL/secret and
publishable keys, `SEED_USER_PASSWORD`, and the seeded demo organiser and two
attendees. The tests create a random-ID approved event, exercise real event
reads, successful registration, full-cap rejection, parallel last-seat
registration and withdrawal, then delete registrations and the event for that
ID. They do not modify seeded events or accounts. See
[Registration integration](registration-integration.md) for setup and the
application-level counter reconciliation limitation.

## Registration windows

Events may set `registration_start` and `registration_end` independently of the
event schedule. They are optional UTC instants: null start means open
immediately; null end means no close time. Both bounds are inclusive. A server
window refusal returns 409, with an opening-time message before the start and
`Registration has closed.` after the end. The handler checks event status and
required fields first, then the window, then duplicates, then claims capacity
and inserts. A window refusal cannot update the seat counter.

Attendee list/detail APIs add the window timestamps and a top-level
`server_time`. The list and detail display local times and a live days/hours/
minutes/seconds countdown before opening. At zero they re-fetch server time;
the form remains disabled until a server response confirms opening. The window
is enforced again by the registration endpoint, so UI state is informational.
Full events keep the existing Full state ahead of their window state.

Organisers may set the fields on a new request; Event Organisers and Event
Coordinators can edit the registration window on a managed event, including
extending it after close. The PATCH is partial and validates the submitted
boundary against the stored other boundary. It allows past dates and null
clears; changing dates does not affect existing registrations.

The project owner added both database columns manually in Supabase; no
migration file exists. New environments must add them manually:

```text
registration_start — timestamptz, nullable — earliest registration instant, UTC.
registration_end   — timestamptz, nullable — latest inclusive registration instant, UTC.
```

The demo seed deliberately omits both keys from event upserts: new rows receive
the nullable default, and existing configured windows survive a reseed. See
[Registration integration](registration-integration.md) for the endpoint,
authorization, countdown retry, and timezone details.

## Waitlists and released-place offers (SCRUM-151 and offer story)

Attendees can join a full event's waitlist and view their own current position.
When capacity opens, the database reconciliation routine offers it to the next
eligible queue attendee. The attendee can accept or decline the offer in My
Registrations; an expired or declined offer is removed and reconciliation can
offer the place to the next attendee. Waitlist routes reuse the
`registrations.manage` permission (attendee only).

### API

| Method | Path | Permission | Response |
| --- | --- | --- | --- |
| POST | `/api/waitlist/:eventId` | `registrations.manage` | `201 { entry, position, server_time }`; `409` if ineligible, not full, already joined/registered, or invalid details; `404` unknown event |
| GET | `/api/waitlist/:eventId` | `registrations.manage` | `200 { entry, position, effective_deadline, server_time }`; a non-member gets `200` with null state; `404` only when event is missing |
| GET | `/api/waitlist/:eventId/state` | `registrations.manage` | Same empty-state behavior for the event-page lookup |
| DELETE | `/api/waitlist/:eventId` | `registrations.manage` | `204`; `404` when the caller has no active entry |
| PUT | `/api/waitlist/:eventId/details` | `registrations.manage` | `200 { entry, effective_deadline, server_time }` |
| POST | `/api/waitlist/:eventId/offer/accept` | `registrations.manage` | `200 { registrationId, serverTime }`; `409` for expired, incomplete, or unavailable offers |
| POST | `/api/waitlist/:eventId/offer/decline` | `registrations.manage` | `204`; `404` if the caller has no offer |
| GET | `/api/registrations/me` | `registrations.manage` | Caller-owned `registrations`, `waitlist`, `offers`, and `server_time` |

Route wiring lives in `backend/src/app.js`; handlers are in
`backend/src/modules/registrations/waitlistHandlers.js`; database access is in
`backend/src/modules/registrations/waitlistService.js`.

### Coordinator waitlist controls

An assigned Event Coordinator can review the active queue, change the
automatic-offer setting, and promote an eligible attendee from the managed
event detail page. A missing setting defaults to enabled. Disabling automatic
offers prevents new automatic offers; existing offers remain reserved and
valid until their deadline. The normal registration path remains blocked while
the queue or an offer reserves capacity.

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/api/managed-events/:eventId/waitlist?limit=50&offset=0` | `events.waitlist.manage` | Ordered queue page, counts, offer deadlines, eligibility and setting |
| GET | `/api/managed-events/:eventId/waitlist/settings` | `events.waitlist.manage` | Read the automatic-offer setting |
| PATCH | `/api/managed-events/:eventId/waitlist/settings` | `events.waitlist.manage` | Set `{ "enabled": boolean }` |
| POST | `/api/managed-events/:eventId/waitlist/:entryId/promote` | `events.waitlist.manage` | Optionally pass `{ "reason": "..." }`; creates a timed offer when capacity is available, otherwise directly confirms the coordinator's override |

The permission is limited to Event Coordinators and each request verifies
event assignment. The queue displays attendee names resolved from Auth
`user_metadata.full_name`; it does not return email, phone, or registration
answers. The coordinator API service and page panel live in
`backend/src/modules/registrations/waitlistCoordinatorService.js`,
`backend/src/modules/registrations/waitlistCoordinator.controller.js`, and
`frontend/src/features/managedEvents/components/WaitlistCoordinatorPanel.jsx`.

### Rules

- The attendee id always comes from verified `req.user.id`. Request-body
  attendee identifiers are ignored.
- The database functions serialize joining, seat claiming, reconciliation and
  offer acceptance. An attendee with a pending/confirmed registration cannot
  also occupy the active queue. A unique constraint prevents duplicate active
  entries.
- Waitlist joining requires an approved, uncancelled event that has not started
  and is full after accounting for offered seats. Registration-window start/end
  values do **not** gate waitlist join or offer acceptance; those windows still
  gate ordinary registration. The event start time does gate eligibility.
- Position is one-based and computed dynamically. Manual overrides order ahead
  of FIFO; otherwise entries use `created_at, id`. Withdrawals and overrides
  therefore update reported positions without persisting stale position values.
- On reconciliation, pending/expired offers are processed before new offers.
  The standard offer duration is three days, with an effective deadline of the
  earlier of expiry and event start. An offer is only made when that deadline
  leaves at least one hour to respond. Multiple available places may be offered
  in queue order.
- Accepting within the effective deadline creates/confirms the attendee's
  registration and consumes the offered seat. Declining or expiry frees the
  reservation and reconciliation advances the queue.
- My Registrations includes the caller's active waitlist entries and offers.
  Ordinary queue entries remain shown as “Waitlist”; open offers appear as
  “Place Offered”; accepted offers appear as registrations. Offer deadlines
  are returned as `LEAST(offer_expires_at, start_time)` with server time.
- Withdrawing deletes the caller's active queue row; it does not decrement the
  event's enrolled-registration count. A repeat withdrawal returns `404`.
- No offer or waitlist response includes another attendee's identity. Storage
  failures return a generic `500`; the server logs provider details, not the
  browser console.

### Schema reference (manual Supabase changes)

The base `event_waitlist_entries` table was created in Supabase before the
offer implementation. Its core contract is a UUID entry id, event and attendee
foreign keys, active status, and creation timestamp. The offer implementation
adds `registration_data jsonb`, `offer_state text`, `offered_at timestamptz`,
`offer_expires_at timestamptz`, `override_at timestamptz`, `override_by uuid`
and `override_reason text`; it also adds constraints and indexes for valid
offers, override ownership, FIFO/override order and expiry lookup.

The database contract uses `enqueue_waitlist_if_full_v2(uuid, uuid, jsonb)`,
`get_my_waitlist_state(uuid, uuid)`, `claim_registration_seat_v2(uuid)`,
`registration_availability_for_events(uuid[])`, and the offer/reconciliation
and coordinator routines verified in Supabase. Database changes are applied
and maintained directly in Supabase; no local SQL scripts or migrations are
needed by the running application or test runners. New environments must
configure the same database contract in Supabase before enabling these
features.

See [Registration test guide](registrations-tests.md) for automated coverage
and opt-in live tests, and
[the SCRUM-151 task note](../.agent/docs/other/SCRUM-151-join-waitlist.md).
The offer story's Jira key was not provided; its task note is
[waitlist-offers.md](../.agent/docs/other/waitlist-offers.md).
