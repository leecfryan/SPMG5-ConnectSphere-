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
Current Registrations: X/MaxEnrollment
Waiting List: Y
```

| Shown | Source | Notes |
| --- | --- | --- |
| X | `events.enrolled_attendees` | Nullable. Null renders as `0`. |
| MaxEnrollment | `events.expected_attendance` | Nullable. Null renders as `-`, not `0`. |
| Y | count of `registrations` where `status = 'waitlisted'` | Always `0` today. See below. |

`events.enrolled_attendees` and `events.expected_attendance` are read directly
from the `events` table. **`docs/event-requests.md` does not list
`enrolled_attendees`** in its copy of the schema; that document is out of date
and the live Supabase schema is the source of truth.

`expected_attendance` is the organiser's *expected* headcount, not a hard
capacity. Nothing rejects a registration once it is reached. The label
"MaxEnrollment" is this feature's display name for the column, not a limit the
system enforces.

## The waiting list is 0 until the waitlist story lands

There is no waitlist concept in the data yet. `registrations.status` is
constrained to `pending`, `confirmed` and `withdrawn`, and nothing writes
`waitlisted`. The service counts rows with that status through
`.select('id', { count: 'exact', head: true })`, so **the Waiting List reads 0
for every event until the waitlist story is implemented and its migration adds
the status to the check constraint.**

The status name is held in one constant, `WAITLIST_STATUS`, at the top of
`managedEvents.service.js`, precisely so that a rename is a one-line change.
Confirm the final status name with that story's owner before it ships - if it
differs, this count silently keeps returning 0.

## Authorisation

Two permissions were added to `backend/src/auth/permissions.js`, both granted
to Event Organisers and Event Coordinators:

| Permission | `record` | Route |
| --- | --- | --- |
| `events.managed.read` | no | `GET /api/managed-events` |
| `events.registrations.read` | **yes** | `GET /api/managed-events/:eventId` |

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

Neither permission carries a `label`, so `/staff/responsibilities` is unchanged
- these are not staff responsibilities.

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

Responses carry only `id`, `name`, `start_time`, `end_time`, `status`,
`enrolled`, `maxEnrollment` and `waitingList`. **Attendee identity and
`registration_data` never leave the server** - the waitlist figure is a
`head: true` count, so no registration row is transferred to be counted.

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
