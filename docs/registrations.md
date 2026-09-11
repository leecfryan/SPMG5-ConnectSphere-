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

### Week 1 — Database and backend

**Day 1–2 (done)**
- Migration files written: registrations table, RLS policies, updated_at trigger, FK to events.
- Backend routes implemented: events list/detail, registration submit, list own, view one, withdraw.
- Files: `supabase/migrations/`, `backend/src/app.js`, `backend/src/modules/registrations/registrationHandlers.js`
- Blockers: none.

**Day 3 — Apply migration and verify DB**
- Apply `20260909000001_create_registrations.sql` in Supabase SQL editor.
- Confirm registrations table, RLS policies, and trigger exist in the Supabase dashboard.
- Files: `supabase/migrations/20260909000001_create_registrations.sql`
- Blockers: need Supabase project credentials (SUPABASE_URL, SUPABASE_SECRET_KEY) in root `.env`. If not set up yet, get them from the team's Supabase project before starting.

**Day 4 — Backend tests**
- Write integration tests for registration routes: duplicate rejection, non-APPROVED event rejection, ownership checks on withdraw, 404 on another attendee's registration.
- Run `npm --prefix backend test` — all passing.
- Files: `backend/tests/integration/registrations.test.js`
- Blockers: none — tests run against a fake auth provider so no live Supabase or event data needed.

**Day 5 — Backend integration with real data**
- Apply `20260910000001_registrations_event_fk.sql` once events table is confirmed live.
- Test all routes with a REST client (Postman / Thunder Client) using a real attendee bearer token.
- Files: `supabase/migrations/20260910000001_registrations_event_fk.sql`, `backend/src/app.js`
- Blockers: **events team must have merged their events table migration and added `APPROVED` as a valid status before this can run.** Also need at least one APPROVED event row seeded in Supabase to test against. Follow up with the events feature owner before Day 5.

### Week 2 — Frontend and wrap-up

**Day 6 — Scrum-32 frontend (register for an event)**
- Sign in as an attendee demo account. Confirm Browse Events shows only APPROVED events.
- Submit a registration via the form. Confirm redirect to My Registrations and row visible in Supabase.
- Test edge: register twice for the same event — confirm error message shown.
- Files: `frontend/src/features/registrations/pages/EventListPage.jsx`, `EventDetailPage.jsx`, `components/RegistrationForm.jsx`
- Blockers: depends on Day 5 being unblocked. If events team is still not ready, frontend will show an empty events list and registration cannot be tested end-to-end.

**Day 7 — Scrum-33 frontend (view own registration status)**
- Confirm My Registrations shows correct event name, date, and status badge for each registration.
- Open a single registration detail — confirm status is correct.
- Confirm direct URL access to another attendee's registration ID returns a 404 error.
- Files: `frontend/src/features/registrations/pages/MyRegistrationsPage.jsx`, `RegistrationDetailPage.jsx`, `components/RegistrationCard.jsx`, `RegistrationStatusBadge.jsx`
- Blockers: needs at least one registration submitted from Day 6. Needs a second seeded attendee account to test the privacy check (use `attendee2.demo@example.com`).

**Day 8 — Scrum-34 frontend (withdraw)**
- Withdraw a registration — confirm status updates to Withdrawn in the UI and in Supabase.
- Confirm the Withdraw button is gone after withdrawal, registration row still exists.
- Confirm withdrawn registration no longer appears as active (status badge shows Withdrawn).
- Files: `frontend/src/features/registrations/pages/RegistrationDetailPage.jsx`, `components/WithdrawButton.jsx`
- Blockers: needs an existing active registration from Day 6 or 7. No new external dependencies.

**Day 9 — Error states, polish, and checks**
- Test all pages with backend stopped — confirm clean error messages, no broken UI.
- Test with expired token — confirm 401 handled gracefully on all routes.
- `npm --prefix frontend run lint` — fix any warnings.
- Mobile viewport walkthrough across all pages.
- Files: `frontend/src/lib/api.js`, `frontend/src/App.css`, any flagged component files
- Blockers: none — all self-contained.

**Day 10 — PR**
- Run `npm --prefix frontend run build` and `npm --prefix backend test` — both clean.
- Final check against Scrum-32, 33, 34 acceptance criteria.
- Open pull request from `feature/Registration` into `main`.
- Files: all
- Blockers: `main` must not have merge conflicts with `feature/Registration`. Pull the latest `main` and rebase before opening the PR.

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

Migration files in `supabase/migrations/`.

---

## Backend

New module at `backend/src/modules/registrations/`.

### Routes

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | /api/events | requireAuth | List events open for registration (`status = APPROVED`) |
| GET | /api/events/:eventId | requireAuth | Single event detail (APPROVED only) |
| POST | /api/registrations | requireAuth | Submit a registration for an event |
| GET | /api/registrations/me | requireAuth | All of the signed-in attendee's registrations |
| GET | /api/registrations/me/:registrationId | requireAuth | Single registration status |
| PATCH | /api/registrations/:registrationId/withdraw | requireAuth | Withdraw a registration |

### Rules enforced server-side

- POST: reject if event `status !== APPROVED`. Reject duplicate registration for the same attendee + event.
- PATCH withdraw: verify the row belongs to `req.user.id` before updating. Return 403 otherwise. Reject if already withdrawn.
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
| `components/RegistrationForm.jsx` | EventDetailPage | Form to submit registration |
| `components/RegistrationStatusBadge.jsx` | MyRegistrationsPage, RegistrationDetailPage | Displays `pending` / `confirmed` / `withdrawn` |
| `components/WithdrawButton.jsx` | RegistrationDetailPage | Withdraw action with confirmation |
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
| 32 | Signed-in attendee can submit a registration for an APPROVED event. Duplicate submissions are rejected. Registration is persisted linked to the attendee and event. Non-APPROVED events are not accessible. |
| 33 | Attendee can see all their own registrations with event name and current status. Cannot access another attendee's registration via URL. |
| 34 | Attendee can withdraw an eligible registration. Status updates to `withdrawn`. The record is retained (not deleted). Withdrawn registrations no longer appear as active. |
