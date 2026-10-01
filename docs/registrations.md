# Current access update

Attendee responsibility is required for browsing and registration. The role and
publication contract in [event access](event-access.md) supersedes older
references below to access for any signed-in user.

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

- POST: reject if event `status !== APPROVED`. Reject duplicate registration for the same attendee + event. Validate required fields from `registration_fields` — missing or blank required fields return 400 with the field's label.
- PATCH withdraw: verify the row belongs to `req.user.id`. Reject if already withdrawn. Reject if `status = confirmed` (organiser has locked it). Reject if the event has already started. Reject if the event starts within 24 hours.
- GET /me routes: always filter by `attendee_id = req.user.id` — never trust a client-supplied attendee ID.

---

## Frontend

New feature folder at `frontend/src/features/registrations/`.

### Pages

| File | Route | Scrum | Description |
| --- | --- | --- | --- |
| `pages/EventListPage.jsx` | /events | 32 | Lists events open for registration |
| `pages/EventDetailPage.jsx` | /events/:eventId | 32 | Event info + registration form |
| `pages/MyRegistrationsPage.jsx` | /registrations/me | 33 | Attendee's registrations + statuses |
| `pages/RegistrationDetailPage.jsx` | /registrations/me/:registrationId | 33, 34 | Single registration status + withdraw |

### Components

| File | Used by | Description |
| --- | --- | --- |
| `components/RegistrationForm.jsx` | EventDetailPage | Form driven by the event's `registration_fields` array — renders one input per field, respects `required`, `label`, and `type`. No fields = submit-only form. |
| `components/RegistrationStatusBadge.jsx` | MyRegistrationsPage, RegistrationDetailPage | Displays `pending` / `confirmed` / `withdrawn` |
| `components/WithdrawButton.jsx` | RegistrationDetailPage | Withdraw action with confirmation step. Only rendered when withdrawal is permitted; replaced by an explanatory note otherwise. |
| `components/RegistrationCard.jsx` | MyRegistrationsPage | Summary card showing event name, date, status |

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
