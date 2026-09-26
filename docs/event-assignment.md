# Coordinator Assignment — Sprint 1 scope

## Scrum tickets

| ID | User story |
| --- | --- |
| Scrum-26 | As an Event Operations Manager, I want to assign an Event Coordinator to a submitted event request so that someone is responsible for planning the event. |

Subtasks Scrum-52 to Scrum-55 sit under this story on the board.

### Scrum-26 — Assign an Event Coordinator

- The Event Operations Manager can see every submitted event request that has no coordinator yet.
- The Manager can see who the Event Coordinators are, with the work each one already holds.
- The Manager can assign one Event Coordinator to one submitted request.
- An assigned request leaves the queue.
- Only the Event Operations Manager can view the queue or assign a coordinator.
- Two Managers acting at the same time cannot overwrite each other's assignment.

Assignment records who is responsible; it does not approve or reject the request, and it does not change the event's status.
Reviewing, approving and rejecting a request belong to later stories (US-36 to US-39).

---

## Database

No new table and no schema change. The existing `events.coordinator_id` column
is written for the first time by this story; the Venue and Equipment features
already read it.

Event Coordinators are staff accounts in Supabase Auth, identified by
`event_coordinator` in `app_metadata.roles`. This is the same admin-controlled
source `requireAuth` reads, so no separate coordinator or profile table is
needed. Only `id`, full name and email are read from an account.

The workload figures shown next to each coordinator are calculated per request
from the `events` table. They are not stored.

| Column used | Type | Notes |
| --- | --- | --- |
| `coordinator_id` | uuid | Null until assigned. Set by this story only. |
| `status` | text | Must be `SUBMITTED` for a request to appear in the queue. |
| `submitted_at` | timestamptz | Queue sort key, oldest first. |
| `created_at` | timestamptz | Tiebreak when `submitted_at` is null. |

---

## Backend

New files in `backend/src/modules/events/` and `backend/src/routes/`.

| File | Description |
| --- | --- |
| `modules/events/coordinators.directory.js` | Reads Event Coordinators from Supabase Auth |
| `modules/events/assignments.service.js` | Queue, workload figures and the assignment rules |
| `modules/events/assignments.controller.js` | Maps rule outcomes to HTTP status codes |
| `routes/assignments.routes.js` | The three routes and their permission guard |

Three functions were added to `modules/events/events.repository.js`:
`assignCoordinator`, `findSubmittedUnassigned` and `findActiveAssignments`.

### Routes

All three are mounted under `/api/internal`, which already requires
`requireAuth` and `internal.access`, and each additionally requires
`events.assign_coordinator`.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | /api/internal/events/unassigned | requireAuth + events.assign_coordinator | Submitted requests with no coordinator, oldest first |
| GET | /api/internal/coordinators | requireAuth + events.assign_coordinator | Event Coordinators with active event count and next event date |
| PUT | /api/internal/events/:eventId/coordinator | requireAuth + events.assign_coordinator | Assign a coordinator to a request |

### Rules enforced server-side

- GET unassigned: returns only `status = SUBMITTED` rows with a null
  `coordinator_id`, sorted by `submitted_at` ascending with `created_at` as the
  tiebreak.
- GET coordinators: returns every account holding the `event_coordinator` role,
  including those with no events, each with `activeEvents` and `nextEventStart`
  counted from events in `SUBMITTED`, `ACCEPTED` or `APPROVED` status.
- PUT coordinator: the `coordinatorId` in the body must be present and must
  belong to an account holding the `event_coordinator` role. The update matches
  only a row that is still `SUBMITTED` and still unassigned, so a request that
  another Manager has already assigned is never overwritten. Only
  `coordinator_id` is written — `status`, `organiser_id` and any other field in
  the body are ignored.

### Responses

| Status | Meaning |
| --- | --- |
| 200 | Assigned, or list returned. An empty list is a 200 with an empty array. |
| 400 | No coordinator chosen |
| 401 | Not signed in |
| 403 | Signed in without `events.assign_coordinator` |
| 404 | No such event request |
| 409 | Already assigned by another Manager — the UI asks the user to refresh |
| 422 | The chosen person is not an Event Coordinator |
| 500 | Storage failure. The underlying error is logged, not returned. |
| 503 | Server data key not configured. Sign-in still works. |

---

## Permissions

| Capability | Holder | Grants |
| --- | --- | --- |
| `events.assign_coordinator` | event_ops_manager | The three routes above and `/events/assignments` |

`event_ops_manager` also gains `internal.access`, because `/api/internal` is
gated on it before any route-specific check runs. Every other internal route
keeps its own capability, so the Manager reaches the assignment queue and no
other internal feature. See [staff access](staff-access.md).

---

## Frontend

New files in `frontend/src/features/events/`.

### Pages

| File | Route | Scrum | Description |
| --- | --- | --- | --- |
| `pages/AssignmentQueuePage.jsx` | /events/assignments | 26 | Queue, request details and coordinator table on one screen |

### Components

| File | Used by | Description |
| --- | --- | --- |
| `components/EventQueueList.jsx` | AssignmentQueuePage | Submitted requests awaiting a coordinator, oldest first. Shows name, date, reference and status. |
| `components/EventDetailPanel.jsx` | AssignmentQueuePage | The selected request, read-only. Shows every field stored on the request. |
| `components/CoordinatorTable.jsx` | AssignmentQueuePage | Event Coordinators with active event count and next event date. One radio per row, with a single confirm button beneath. |

### Services

| File | Description |
| --- | --- |
| `assignmentsService.js` | The three API calls, with the signed-in user's token attached |
| `eventFormat.js` | Date and reference formatting shared with the event request screens |

The Manager selects a request, selects a coordinator, then confirms. The
coordinator's workload is shown for information only — no row is disabled,
ranked or pre-selected, because a coordinator may hold several events at once.

---

## Acceptance criteria

| Scrum | Done when |
| --- | --- |
| 26 | The Event Operations Manager can open `/events/assignments` and see all submitted, unassigned requests, oldest first. Each request's full details are readable without being editable. All Event Coordinators are listed with their current active event count and next event date, including coordinators with no events. Selecting a request and a coordinator and confirming assigns that coordinator, and the request leaves the queue. The event's status is unchanged. A request already assigned by another Manager returns a message asking the user to refresh, and the existing assignment is kept. A coordinator id that does not belong to an Event Coordinator is rejected. No other role can reach the page or the API. |

---

## Testing

77 automated cases.

| Layer | File | Cases |
| --- | --- | --- |
| Directory (unit) | `backend/tests/unit/events/coordinators.directory.test.js` | 22 |
| Service and repository (unit) | `backend/tests/unit/events/assignments.service.test.js` | 19 |
| API (integration) | `backend/tests/integration/events.assign.test.js` | 22 |
| Page (frontend) | `frontend/src/features/events/AssignmentQueuePage.test.jsx` | 14 |

The full case table is in [coordinator assignment tests](event-assignment-tests.md).
Permission coverage for `event_ops_manager` is in
`backend/tests/integration/auth.test.js` and `frontend/src/Rbac.test.jsx`.

No test connects to Supabase.

```sh
npm --prefix backend test
npm --prefix frontend run test:report
npm --prefix backend run check
npm --prefix frontend run lint
npm --prefix frontend run build
```

### Manual verification

Seed accounts are listed in [seed users](seed-users.md); run
`npm --prefix backend run seed:users` if they are not yet created.

1. Sign in as `organiser.demo@example.com` and submit two event requests at
   `/events/new`, so the queue has data.
2. Sign in as `eventopsmanager.demo@example.com`. "Assign coordinators" appears
   in the workspace navigation and the queue lists both requests, oldest first.
3. Assign one request. It leaves the queue, and the event row in Supabase shows
   `coordinator_id` set with `status` still `SUBMITTED`.
4. Open the queue in two tabs and assign the same request in both. The second
   reports that the request was assigned by someone else.
5. Assign every request. The queue shows its empty message.
6. Sign in as `coordinator.demo@example.com`. There is no "Assign coordinators"
   link, and opening `/events/assignments` directly shows `/forbidden`.

---

## Requirements sources

| Ref | What it says |
| --- | --- |
| #42 | After an event request is submitted, an Event Operations Manager assigns an Event Coordinator. |
| #1 | There is no acceptance step; any issue is handled outside the system. |
| #3 | The choice of coordinator is up to the Event Operations Manager and their own SOP, outside the system. |
| #2 | Reassignment is by the Operations Manager and may be assumed already approved. |

Reassignment (US-50), search and filtering on the queue (US-49), notifying the
coordinator (US-29 to US-32) and review or approval of a request (US-36 to
US-39) are later stories and are not implemented here.
