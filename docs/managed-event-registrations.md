# Registration information for managed events

As an Event Organiser or Event Coordinator, you can see how many people are
registered for the events you own or manage, and how many are waiting.

| URL | Purpose |
| --- | --- |
| `/events/managed` | Events you submitted as an organiser, or that were assigned to you as a coordinator |
| `/events/managed/:eventId` | That event's registration counts |

Both pages sit inside the shared `AuthProvider`, require a verified session, and
are gated on `events.managed.read`. The "My Events" tab in the workspace
navigation is gated on the same permission, so an Attendee never sees it and is
sent to `/forbidden` if they type the URL.

## What the detail page shows

```
Current Registrations: X/MaxEnrollment (Full when X reaches the cap)
Waiting List: Y
```

| Shown | Source | Notes |
| --- | --- | --- |
| X | `events.enrolled_attendees` | Nullable. Null renders as `0`. |
| MaxEnrollment | `events.expected_attendance` | Nullable. Null renders as `-`, not `0`. |
| Registration opens/closes | `events.registration_start` / `events.registration_end` | Nullable UTC instants; null start opens immediately, null end is unbounded. |
| Y | count of `registrations` where `status = 'waitlisted'` | Always `0` today. See below. |

`events.enrolled_attendees`, `events.expected_attendance`,
`events.registration_start`, and `events.registration_end` are read directly
from the `events` table. **`docs/event-requests.md` does not list
`enrolled_attendees`** in its copy of the schema; that document is out of date
and the live Supabase schema is the source of truth.

For registration capacity, `expected_attendance` is now treated as the event's
hard cap. Event organisers should set it to the maximum number of registrations
the event can accept. A null value means no cap is configured; zero means the
event is full immediately. The managed-event list and detail page show the
current count against this cap and mark a full event.

Registration uses a server-side compare-and-set update of
`events.enrolled_attendees` before inserting the registration. Concurrent
attempts retry up to three times. A full event returns 409; its message says
waiting-list redirection is pending implementation, but no redirect or waitlist
is currently provided. Both `pending` and `confirmed` registrations occupy a
seat; new registrations are inserted as `pending`. Failed inserts attempt a
guarded counter rollback, and withdrawing a pending registration attempts a
guarded decrement. Confirmed registrations cannot be withdrawn by the current
flow.

## The waiting list is 0 until the waitlist story lands

There is no waitlist concept in the application yet. Registration writes
`pending`, while `confirmed` and `withdrawn` are handled by the existing
workflow; nothing writes `waitlisted`. The service counts rows with that status through
`.select('id', { count: 'exact', head: true })`, so **the Waiting List reads 0
for every event until the waitlist story is implemented. Full registrations
are refused rather than queued. Implementing a waitlist will require a defined
status and verified database support; this change does not modify Supabase.

The status name is held in one constant, `WAITLIST_STATUS`, at the top of
`managedEvents.service.js`, precisely so that a rename is a one-line change.
Confirm the final status name with that story's owner before it ships - if it
differs, this count silently keeps returning 0.

## Authorisation

Three permissions are defined in `backend/src/auth/permissions.js`; all are
granted to Event Organisers and Event Coordinators:

| Permission | `record` | Route |
| --- | --- | --- |
| `events.managed.read` | no | `GET /api/managed-events` |
| `events.registrations.read` | **yes** | `GET /api/managed-events/:eventId` |
| `events.registration-window.update` | **yes** | `PATCH /api/managed-events/:eventId/registration-window` |

The update permission is granted to Event Organisers and Event Coordinators.
The patch route repeats the event ownership/assignment check and only accepts
window values; it cannot update event status, ownership, registration counts or
other event fields. See [Registration integration](registration-integration.md)
for partial-update validation and the manually added Supabase columns.

The managed-event detail page includes the registration-window editor. It shows
the close time and a reopen hint after the window has closed. Past end dates are
valid inputs so a coordinator or organiser can extend the window.

The list scopes `organiser_id` / `coordinator_id` in its own query, so it needs
no record resolver. The single event does: `canManageEvent` in
`managedEvents.routes.js` runs one scoped lookup, returns `true` only when the
event is the caller's, and stashes the row on `req.managedEvent` so the
controller does not fetch it again.

Ownership is a `WHERE` clause built from the verified session id, never a
parameter a request can supply:

```js
client.from("events").select(EVENT_FIELDS).or(`organiser_id.eq.${userId},coordinator_id.eq.${userId}`)
```

The user id is asserted to be a UUID by `isEventId` before it is spliced into
that Postgrest filter.

None of these permissions carries a `label`, so `/staff/responsibilities` is
unchanged - these are not staff responsibilities.

### Denials are deliberately identical

An event belonging to someone else and an event that does not exist both fail
the same scoped query, so both answer **403 with the same body**. A caller
cannot learn whether an event exists but is not theirs. `requirePermission`
requires the resolver to return exactly `true`, so this is the denial path for
every case.

The frontend collapses 403 and 404 into one message - "You don't have access to
registration information for that event." They are not distinguished because the
server cannot distinguish them, and telling someone a stale link points at a
non-existent event would send them looking for a broken link instead of the
truth: they cannot see it.

## API

| Method | Path | Permission | Response |
| --- | --- | --- | --- |
| GET | `/api/managed-events` | `events.managed.read` | `{ events: [...] }` |
| GET | `/api/managed-events/:eventId` | `events.registrations.read` | `{ summary: {...} }` |
| GET | `/api/managed-events/:eventId/registration-window` | `events.registrations.read` | `{ window: {...}, server_time }` |
| PATCH | `/api/managed-events/:eventId/registration-window` | `events.registration-window.update` | `{ event: {...}, server_time }` |

The summary response carries only `id`, `name`, `start_time`, `end_time`,
`status`, `enrolled`, `maxEnrollment` and `waitingList`. The separate
registration-window response carries only `registration_start` and
`registration_end`, plus server time. **Attendee identity and
`registration_data` never leave the server** - the waitlist figure is a
`head: true` count, so no registration row is transferred to be counted.
The PATCH response returns the updated event fields and server time.

The router is mounted at `/api/managed-events`, not `/api/internal` (Event
Organisers hold no `internal.access`) and not `/api/events` (the registration
router's `GET /:eventId` would swallow the detail path). The storage check runs
after the permission check, so a missing secret key answers 403/401 before 503.

### `select()` takes a string, never an array

`EVENT_FIELDS` is a comma-separated string, like the one in
`equipment.dependencies.js`. The pinned `@supabase/postgrest-js` implements
`select()` as `(columns ?? "*").split("")`, so passing an array throws
`TypeError: ...split is not a function` synchronously - before any request is
sent - and surfaces as a `500 {"error":"Internal server error"}` with nothing
wrong on the Supabase side. The fakes in this module's tests throw the same way,
so the mistake fails a test instead of a page.

## Status values

`DRAFT`, `SUBMITTED` and `APPROVED` exist today. `UNDER_REVIEW`, `REJECTED`,
`CONFIRMED` and `CANCELLED` are named in the Week 4 instructions but are not
implemented; the list page displays whatever the column holds rather than
switching on it, so a new backend status is visible instead of hidden.

## Tests

```sh
npm --prefix backend exec -- vitest run tests/unit/managedEvents tests/integration/managedEvents.permissions.test.js
npm --prefix frontend exec -- vitest run src/features/managedEvents
```

`backend/tests/integration/managedEvents.permissions.test.js` drives the real
app over HTTP and covers organiser match, coordinator match, unrelated event,
wrong role, client-supplied role claims, malformed ids, and the rule that an
unrelated event and a non-existent event answer identically.
