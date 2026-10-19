# Restrict internal staff access by responsibility

## Current scope

The backend has a staff permission policy and reusable guards. GET
/api/internal/access returns the verified staff member's responsibilities.
External users receive 403 and users without valid authentication receive 401.
The `/staff/responsibilities` page loads these responsibilities from that protected endpoint.
Frontend routing and navigation use server-derived permission identifiers from
`GET /api/auth/me`; the API guards remain the security boundary. See
[frontend routing](frontend-routing.md) for the teammate integration contract.

The integrated Venue feature has authenticated catalogue, calendar, editing and
booking-request APIs. Its coordinator queries use the existing events.coordinator_id
relationship; Venue Staff review venue requests across locations. See
[Venue integration](venue-integration.md). Equipment request and thread APIs are integrated with assigned-coordinator or
technical-staff scope. The role-specific event workspaces enforce organiser
ownership and coordinator assignments. Client and attendee *planning* endpoints
remain future feature work; capability names alone do not implement them.
See [event access](event-access.md) for the current end-to-end contract.

The integrated event feature separately grants `events.submit` to Event Organisers
for `POST /api/events` and `/events/new`. This does not grant internal access.
See [event-request integration](event-request-integration.md).

Venue writes use separate capabilities: `venues.update` for Venue Staff and
Event Coordinators, and `bookings.request` for Event Coordinators. They do not
change the read responsibilities listed below or grant external roles access.

Event writes use `events.submit` and `events.own.update` (Event Organisers, external),
`events.assign_coordinator` (Event Coordinator Leads), and `events.decide` and
`events.safety.submit` (the event's assigned Event Coordinator). None appears in the
read matrix below, which lists read permissions only. The Safety Officer's
`events.safety.read` (SCRUM-140) and `events.safety.decide` (SCRUM-141) are described under
*SCRUM-142 — Safety Officer*.

| Write capability | Holder | Guards |
| --- | --- | --- |
| `venues.update` | Venue Staff, Event Coordinators | Venue editing |
| `venues.unavailability` | Venue Staff | Mark and manage venue unavailability periods (SCRUM-133) |
| `venues.holds` | Venue Staff | Place and view tentative holds (SCRUM-146) |
| `bookings.request` | Event Coordinators | Booking requests |
| `events.submit` | Event Organisers | `POST /api/events`, `/events/new`; the draft routes `/api/events/drafts[/:id[/submit]]`, scoped to the caller's own drafts (SCRUM-147) |
| `events.own.update` | Event Organisers | `PATCH /api/event-workspace/organiser/:id`; owner check in lookup and write; colleague events remain view only |
| `events.assign_coordinator` | Event Coordinator Leads | The assignment queue: `GET /api/internal/events/unassigned`, `GET /api/internal/coordinators`, `PUT /api/internal/events/:eventId/coordinator` |
| `events.postpone` | Event Coordinators assigned to the event, Event Coordinator Leads | `POST /api/internal/events/:eventId/postpone`; coordinators retain the assignment check (SCRUM-149/142) |
| `events.waitlist.manage` | Event Coordinators assigned to the event | Coordinator waitlist listing, offer settings and manual promotion; leads do not gain this capability (SCRUM-142 staging integration) |
| `events.decide` | Event Coordinators, **assigned event only** (record check on `coordinator_id`) | `POST /api/internal/events/:eventId/{start-review,approve,reject,confirm}`, `PATCH /api/internal/events/:eventId/arrangements/:kind/:requestId` (SCRUM-144) |
| `events.safety.submit` | Event Coordinators, **assigned event only** (same record check) | `GET /api/internal/events/:eventId/safety-readiness`, `POST /api/internal/events/:eventId/{submit-safety-check,withdraw-safety-check}` |
| `events.safety.decide` | Safety Officers (a pool; no record check) | `POST /api/internal/safety-reviews/:eventId/{approve,reject}` (SCRUM-141) |

A capability name ending in `.read` is refused for every non-GET by
`requirePermission`, which is why the assignment capability is not named
`events.assignments.read`.

## Staff read matrix (manager workflow described below)

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
| event_organisers.read | No | No | Yes | No | Yes |

All five internal roles, including `event_coordinator_lead` and `safety_officer`, have `internal.access`.
Safety Officer's feature permissions are `events.safety.read` (SCRUM-140), its
one listed responsibility, and `events.safety.decide` (SCRUM-141, unlabelled, so the
responsibilities list is unchanged). It does not receive the assigned coordinator's
`events.safety.submit` capability or any other write permission.
Managers have `events.review` and `events.assign`, not venue/equipment booking
permissions. Coordinators have `events.assigned.read`; organisers have
`events.own.read`, `events.own.update` and `events.submit`. Only attendee responsibility grants
`events.browse` and `registrations.manage`. Unknown roles grant nothing.
Multiple trusted roles combine capabilities while retaining each record scope.

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
- The eight read permissions against the original five roles, plus the Event
  Event Coordinator Lead's internal-access grant in the authentication tests —
  which asserts the blast radius, not just the grant: the manager reaches
  `/api/internal/access` and is still refused all six venue, equipment and
  technical-support routes.
- Venue/equipment access across locations and types.
- Multi-role accounts, role removal, and missing or malformed roles.
- Anonymous/invalid sessions and forged role claims.
- Rejection before data handlers or relationship lookups run.
- Unrelated/missing event records, failed lookups and read-versus-write requests.

Existing authentication tests continue to run in the same CI job.

Manual checks:
1. Sign in as Venue Staff and open `/staff/responsibilities`: see only venue and booking responsibilities.
2. Sign in as Technical Support Staff: see only equipment and technical responsibilities.
3. Sign in as Event Coordinator: see the coordination responsibilities. The
   workspace nav has no "Assign coordinators" link, and `/events/assignments`
   opens `/forbidden` despite the account holding `internal.access`.
4. Sign in as Event Coordinator Lead: "Assign coordinators" appears, the
   queue loads, and `/venues`, `/equipment/requests` and `/technical-support`
   all open `/forbidden`.
5. Sign in as Organiser or Attendee: no staff navigation link; entering
   `/staff/responsibilities` directly opens `/forbidden`. An authenticated request
   to /api/internal/access returns 403.
6. Without a token, /api/internal/access returns 401. Direct browser navigation
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

## Equipment integration

Equipment uses this same trusted role matrix. Coordinators submit requests for assigned events; technical support reviews arrangements across events. Both use scoped clarification threads. See [Equipment integration](equipment-integration.md) for routes, action permissions and database prerequisites.

## SCRUM-142 — Event Coordinator Lead

Event Coordinator Lead replaces Event Operations Manager. The canonical trusted
role is `event_coordinator_lead`, including permission policies, account labels,
coordinator assignment and unrestricted lead cancellation. Its responsibilities
and permissions are unchanged. Multiple trusted roles still combine capabilities
without bypassing record checks.

`requireAuth` translates the legacy `event_ops_manager` claim **only after**
Supabase verifies the caller and reads administrator-controlled
`app_metadata.roles`. It returns `event_coordinator_lead` and deduplicates it with
any existing canonical claim. No active policy or cancellation check grants the
legacy identifier directly. User-editable metadata, request headers, body and
query parameters cannot activate this compatibility rule.

### Schema reference: manual Auth metadata update

No schema change or migration file is needed. Existing Supabase Auth accounts
still need their stored role renamed. Tell teammates before running this update
and after verifying it. Run the SQL manually in the Supabase dashboard SQL Editor;
the agent does not execute it. Deploying the compatible application code before
updating stored roles avoids a period when old application code rejects the new
identifier. The compatibility rule preserves access while stored claims are old.

Preview affected accounts:

```sql
select id, raw_app_meta_data -> 'roles' as roles
from auth.users
where jsonb_typeof(raw_app_meta_data -> 'roles') = 'array'
  and (raw_app_meta_data -> 'roles') @> '["event_ops_manager"]'::jsonb;
```

Replace only that role, preserving other metadata and other roles. Duplicate
legacy/canonical entries become one canonical role in the earliest position.
The update can be repeated safely; after the first successful update it matches
no additional accounts.

```sql
update auth.users as u
set raw_app_meta_data = jsonb_set(
  u.raw_app_meta_data,
  '{roles}',
  (
    select jsonb_agg(role_value order by first_position)
    from (
      select
        case when assigned.role_value = '"event_ops_manager"'::jsonb
          then '"event_coordinator_lead"'::jsonb
          else assigned.role_value
        end as role_value,
        min(assigned.position) as first_position
      from jsonb_array_elements(u.raw_app_meta_data -> 'roles')
        with ordinality as assigned(role_value, position)
      group by case when assigned.role_value = '"event_ops_manager"'::jsonb
        then '"event_coordinator_lead"'::jsonb
        else assigned.role_value
      end
    ) as canonical_roles
  ),
  false
)
where jsonb_typeof(u.raw_app_meta_data -> 'roles') = 'array'
  and (u.raw_app_meta_data -> 'roles') @> '["event_ops_manager"]'::jsonb
returning id, raw_app_meta_data -> 'roles' as roles;
```

Verify that the preview query now returns zero rows, then sign in as an existing
lead account and confirm its account label, management and assignment access.
Verify other roles on a combined-role account still work. Do not replace a
user's entire metadata object or roles array with only the new role.

The existing demo identity `eventopsmanager.demo@example.com` is unchanged to
preserve its user ID and relationships. New seed accounts use the canonical role
and the display name Demo Event Coordinator Lead. Update old seeded role metadata
before rerunning the seed: its existing collision check deliberately refuses to
overwrite accounts whose trusted roles differ.

### Rename verification

- `backend/tests/integration/roles.rename.test.js`: canonical and legacy claims,
  exact permission list, duplicate/combined roles, assignment access, unrestricted
  lead cancellation, denied coordinator decisions, spoofing refusal with unchanged
  event data, and role removal on the next request.
- `frontend/src/Rbac.test.jsx`: SCRUM-142 account display and combined navigation.
- `tests/playwright/api.spec.cjs`: SCRUM-142 canonical/legacy identity and revocation
  over the real local Auth simulator.
- `tests/playwright/browser.spec.cjs`: SCRUM-142 canonical/legacy sign-in, display,
  manager navigation, refresh and direct-route denial.

The 2026-10-13 staging integration also preserves SCRUM-149 postponement for
canonical and legacy lead accounts, with venue release and equipment retention,
while coordinator waitlist management remains coordinator-only. Verification
adds SCRUM-142-INT-011/012/013 and SCRUM-142-MERGE-API/BROWSER-001/002 in the existing suites.

**Updated 2026-10-16 (SCRUM-150):** the "equipment retention" half of this note no longer
holds - postpone now releases equipment reservations the same way cancel does (see
`.agent/docs/other/SCRUM-150-equipment-reschedule-review.md`). SCRUM-142-INT-011/012 and
the equivalent Playwright cases (SCRUM-142-MERGE-API-001/002) had their one outdated
assertion (and title) changed to match this new release behaviour; everything else they
verify is unchanged.
The frontend cancel/postpone controls include SAFETY_REVIEW to match the existing
server status lists; POSTPONED is cancellable but not postponable again.

The SCRUM-142 working plan and execution reports stay outside this repository
under Ryan's local reporting preferences. Manual UAT and the shared Auth update
remain unexecuted until Ryan runs them.


## SCRUM-142 — Safety Officer

Ryan confirmed on 2026-10-13 that this story registers Safety Officer as staff;
its safety review permissions and workflow belong to a separate story. The trusted
identifier is `safety_officer`, displayed as **Safety Officer**. SCRUM-142 granted
only `internal.access`. SCRUM-140 adds `events.safety.read` (label *Operational
safety review*, no record check: officers are a pool, not assigned per event). It
guards `GET /api/internal/safety-reviews` and `GET /api/internal/safety-reviews/:eventId`
and the `/safety-reviews` pages; as a `*.read` permission it refuses every non-GET.
SCRUM-141 adds `events.safety.decide` (no label, no record check) for
`POST /api/internal/safety-reviews/:eventId/{approve,reject}`; it changes only the
event's status and writes its activity history, never the event's details.
Account, Notifications, Safety reviews and Responsibilities are available.
Officer-only accounts cannot access lead, coordinator, venue, equipment or attendee
business functions, including coordinator safety-check submission and withdrawal.

Roles remain additive: an officer can also hold `attendee`, `venue_staff` or
`event_coordinator_lead`; the other role's permissions and record checks still apply.
Removing officer removes only the capability it grants; another internal role can
still provide staff access. Editable `user_metadata.roles` and request claims cannot
assign this role.

### Assignment and schema reference

No schema SQL is needed to recognise this role. Recognition does not assign it to
any existing user. An administrator must append `safety_officer` to the target
user's existing admin-controlled `app_metadata.roles` array, preserving other roles
and metadata, through the team's trusted Auth administration process. Tell teammates
before and after changing shared assignments. Sign out and in to refresh the UI;
the server verifies current roles on every request. The optional demo seed now
creates `safety.demo@example.com`; see [seed users](seed-users.md). Neither the seed
nor any shared Auth update has been run by the agent.

### Verification and manual UAT

- `backend/tests/integration/roles.rename.test.js`: SCRUM-142-SAFETY-INT-001–006 cover
  trusted identity, exact capabilities, duplicate/combined roles, next-request
  removal, legacy-lead coexistence, forged claims and refused writes with unchanged
  stored event and no venue/equipment release callbacks.
- `frontend/src/Rbac.test.jsx`: SCRUM-142-SAFETY-UI-001–008 cover role labels,
  combined navigation, empty responsibilities and direct-page refusal.
- `tests/playwright/api.spec.cjs`: SCRUM-142-SAFETY-API-001–011 exercise all eight
  read responsibility families, identity, combined-role access/removal and forged
  editable metadata against the real SDK and local Auth simulator.
- `tests/playwright/browser.spec.cjs`: SCRUM-142-SAFETY-BROWSER-001–002 exercise
  mobile sign-in, reload, navigation, direct URL denial, combined roles and removal.

SCRUM-140 updated the expectations of SCRUM-142-SAFETY-INT-001–004, -UI-001 and -003,
-API-009–010 and -BROWSER-001 to include `events.safety.read`; nothing else changed.
SCRUM-141 updated SCRUM-142-SAFETY-INT-001–004 and -API-009–010 the same way to include
`events.safety.decide`; they still assert the exact permission list.

Manual UAT is **Not Executed**. Assign officer-only, sign in and verify Account
shows Safety Officer; open Responsibilities and refresh to see *Operational safety review*.
Open `/event-management`, `/events/assignments`, `/assigned-events`, `/venues` and
`/technical-support` directly and expect Access denied. Then append officer to an
attendee or existing staff account, sign out/in and verify both role labels and
the original role's functions; remove only officer and verify remaining access.
Existing lead rename UAT and its manual Auth update remain separate pending work.
The test specifications and genuine automated execution report stay outside the
repository under Ryan's local reporting preferences.
