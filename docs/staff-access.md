# Restrict internal staff access by responsibility

## Current scope

The backend has a staff permission policy and reusable guards. GET
/api/internal/access returns the verified staff member's responsibilities.
External users receive 403 and users without valid authentication receive 401.
The account screen loads these responsibilities from that protected endpoint.

There are no production venue, booking, equipment, technical-request, attendee,
client or internal-planning data endpoints yet. The tests use fixture handlers;
they are not shipped as business APIs. Full story acceptance on real records
requires the feature owners to attach these guards and implement scoped database
queries. This implementation does not make unguarded future endpoints safe.

## Initial agreed matrix

The user approved this conservative starting point in this task. It is an
implementation decision for team review, not a complete customer permission
specification.

| Read permission | Venue Staff | Technical Support Staff | Event Coordinator | Event Organiser / Attendee | Record check required |
| --- | --- | --- | --- | --- | --- |
| venues.read | Yes | No | Yes | No | No; venue catalogue/availability only |
| bookings.read | Yes | No | Yes | No | Yes |
| equipment.read | No | Yes | Yes | No | No; equipment catalogue/availability only |
| technical_requests.read | No | Yes | Yes | No | Yes |
| event_planning.read | No | No | Yes | No | Yes |
| attendees.read | No | No | Yes | No | Yes |
| clients.read | No | No | Yes | No | Yes |

All internal roles have internal.access. Unknown or missing roles grant nothing.
Multiple trusted roles combine responsibilities. External roles grant no internal
permissions, but can have separate event-specific access through external APIs.

Venue and equipment catalogue access is not limited by assigned venue, equipment
type or location. Availability responses must not expose unrelated client,
attendee or internal-planning information. Requests and bookings need relevant
event information, not the entire event record. Add only the necessary fields.

A permission in the access response indicates a role capability. It does not
grant access to every record or authorise mutations.

## Teammate integration

backend/src/app.js protects /api/internal with requireAuth and internal.access.
Register internal feature routes after this gate. Add a specific permission
guard to every data endpoint.

For a venue catalogue route inside app.js, the integration pattern is:

```js
app.get("/api/internal/venues",
  requirePermission("venues.read"),
  listVenues);
```

listVenues is the feature owner's real handler; it must select only venue fields.
Read guards accept only GET and HEAD. Add explicit action-specific permissions
and tests when implementing writes; do not reuse a read permission for them.

For a record-specific route, supply a server-side resolver:

```js
app.get("/api/internal/events/:eventId/attendees",
  requirePermission("attendees.read", canReadEventAttendees),
  listEventAttendees);
```

canReadEventAttendees(req) must load trusted event/client relationships and return
exactly true only when req.user.id is authorised for that event. Do not trust
body/query fields claiming ownership, assignment, membership, or role.
Missing/unrelated records return false. Lookup failures deny access.
The handler should use the authorised record/scope loaded by the resolver rather
than reusing an unvalidated event ID. For list endpoints, the resolver must
establish a server-controlled query scope and the handler must apply it.

The actual relationship schema and field selection belong to the feature owner.
Coordinate these contracts with them. No event/coordinator/client schema has
been invented here. For Venue Staff and Technical Support Staff, a resolver must
reflect their relevant operational responsibilities, not introduce a restriction
by physical venue, equipment type or location.

If you mount a route outside /api/internal, apply requireAuth(authClient)
before requirePermission. Hiding a frontend control is not backend protection.

## Trusted role source and database access

requireAuth verifies the token with Supabase and reads app_metadata.roles.
requirePermission uses only this verified req.user. It ignores request headers,
query/body role claims, accountTypes, and user-editable metadata.
The Supabase role named authenticated is not an application staff role.

These Express guards do not secure direct Supabase Data API queries. New tables
must have appropriate database grants and RLS before being exposed. Browser
clients must not use the secret key. Backend queries made with the admin client
must still be guarded and scoped, because that client can bypass RLS.

## Acceptance evidence

Run npm --prefix backend test. permissions.test.js covers:
- The seven read permissions against all five roles.
- Venue/equipment access across locations and types.
- Multi-role accounts, role removal, and missing or malformed roles.
- Anonymous/invalid sessions and forged role claims.
- Rejection before data handlers or relationship lookups run.
- Unrelated/missing event records, failed lookups and read-versus-write requests.

Existing authentication tests continue to run in the same CI job.

Manual checks:
1. Sign in as Venue Staff: see only venue and booking responsibilities.
2. Sign in as Technical Support Staff: see only equipment and technical responsibilities.
3. Sign in as Event Coordinator: see the coordination responsibilities.
4. Sign in as Organiser or Attendee: no staff section; an authenticated request
   to /api/internal/access returns 403.
5. Without a token, /api/internal/access returns 401. Direct browser navigation
   does not attach the bearer token even if another tab is signed in.

## Requirements sources

The user-supplied story requires role/responsibility access, no restriction by
venue/equipment type/location, and protection of unrelated information.
Week 4 requires access appropriate to role and event relationship.
Discussion 66 repeats the scope-by-responsibility rule:
https://github.com/SinYang13/IS212-2026/discussions/66
Discussion 91 describes protected information:
https://github.com/SinYang13/IS212-2026/discussions/91
These were read from the supplied export. Section applicability remains to be
confirmed; the supplied story and user's approved starting matrix drive this
implementation. No extra role was inferred from other discussions.
