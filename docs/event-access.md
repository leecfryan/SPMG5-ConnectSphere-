# Event ownership and staff responsibilities

Coordinators are separate Supabase accounts with the same `event_coordinator`
role. `events.coordinator_id` determines whose planning workspace contains an
event. A role name, URL parameter, or submitted user ID never proves ownership.

| Account responsibility | Event access |
| --- | --- |
| Attendee | Browse events open for registration; manage only their own registrations |
| Event organiser (external client) | Submit requests; view and edit responsible events; view other events in the same client organisation only |
| Event operations manager | See requests and assign or reassign a verified coordinator account |
| Event coordinator | See requirements and arrange bookings only for assigned events |
| Venue staff | Venue catalogue and booking requests across all venues |
| Technical support staff | Equipment catalogue, equipment bookings and their clarification threads across all events |
| Venue + technical staff | Both booking workspaces; no general event planning or attendee browsing |

Permissions combine for accounts with multiple responsibilities. The scope of
each permission still applies: venue responsibility does not grant full event
planning access, and coordinator responsibility does not grant access to another
coordinator's planning records. Managers and organisers use separate workspaces
from attendee browsing. Unknown roles grant nothing.

## Implementation contract

The `/api/event-workspace` endpoints expose organisation-scoped organiser requests,
coordinator-assigned events, and manager assignment. Database filters use
the authenticated account ID, including direct detail requests. Coordinator
choices come from admin-controlled Auth roles, not browser-supplied role claims.
Manager writes validate the current event state and use a conditional database
update to reject stale assignments.

React Router protects each workspace by a server-derived capability; Express
enforces the same capability independently. `/api/events` browsing and
`/api/registrations` additionally require attendee permissions. Booking APIs keep
their own role and record checks. Venue availability remains visible for planning
but hides unrelated event names from coordinators.

Tests must cover two coordinators, direct URL/API access to another assignment,
multi-role accounts, manager-only assignment, revoked roles, and organisers'
ownership. Test fixtures must not substitute for a production assignment API.

## Review, planning and registration

The statuses are the eight in `backend/src/modules/events/lifecycle.js`
(see [Event requests](event-requests.md) §Status values).

1. Organiser submits: `SUBMITTED`.
2. Manager selects a confirmed, active account with `event_coordinator` in its
   admin-controlled roles, while the event is `SUBMITTED`, `UNDER_REVIEW`,
   `APPROVED` or `CONFIRMED` (`ACTIVE_STATUSES`). Assignment does not change the
   status (discussion #95). Assignments can be changed; the former coordinator
   loses API access on the next request. Stale assignment updates return 409.
3. The **assigned coordinator** reviews and decides (SCRUM-98/99, discussions #80,
   #101): *Start review* → `UNDER_REVIEW`, then *Approve* → `APPROVED` or
   *Reject* → `REJECTED`. The manager does not accept or reject.
4. Venue and equipment requests require an approved event, `APPROVED` or
   `CONFIRMED` (`PLANNING_STATUSES`). Approval itself books nothing.
5. When registration opens is the Registration lane's registration start time
   (US-60), not a manager action and not approval on its own.

Rejected requests remain visible to their organiser, the coordinator who rejected them, and the manager. Reopening rejected requests remains outside this change. Venue
booking confirmation is provided by staging's Venue Staff decision workflow;
it does not publish the event. Technical review is shared across technical staff, not
assignment to an individual technician.

## Routes

| API | Capability and scope |
| --- | --- |
| `GET /api/event-workspace/organiser[/<id>]` | `events.own.read`; own events plus owners sharing trusted organisation metadata |
| `PATCH /api/event-workspace/organiser/<id>` | `events.own.update`; authenticated ID must equal organiser_id in both lookup and UPDATE |
| `GET /api/event-workspace/coordinator[/<id>]` | `events.assigned.read`; coordinator_id = authenticated ID, active and rejected events |
| `GET /api/event-workspace/manager[/<id>]` | `events.review`; active and rejected requests |
| `GET /api/event-workspace/coordinators` | `events.assign`; only IDs, names and emails of active coordinator accounts |
| `PATCH /api/event-workspace/<id>/coordinator` | Manager; `{coordinatorId, expectedCoordinatorId}`; active events only |

The former manager `decision` (accept/reject) and `publication` (open
registration) endpoints were removed: they wrote `ACCEPTED`, which is not one of
the eight statuses. The coordinator's review actions are
`POST /api/internal/events/:eventId/{start-review,approve,reject}` (see
[Event requests](event-requests.md)). The manager-only `/events/assignments` page
and `/api/internal/events/:eventId/coordinator` API also assign submitted,
unassigned requests.

## Deployment and verification

The existing `supabase/migrations/007_event_review_and_assignment.sql` records
the RBAC SQL needed **after the authenticated venue booking wrapper and before
deploying this code**. Earlier venue migrations 001–006 were removed on staging;
their schema and functions are recorded in `docs/venue-integration.md`. Apply
schema changes manually in the Supabase dashboard after reviewing the live
schema; Git merging does not run SQL. The RBAC SQL adds ACCEPTED/REJECTED to existing single-column
text status CHECKs without removing their previous allowed values, indexes owner
and coordinator lookups, and rechecks accepted status inside the atomic venue
booking RPC. It does not reset business records. It aborts if the status column
has an unexpected type; review custom multi-column status constraints separately.

**Schema reference (2026-10-01).** 007 was applied to the live database, so its
booking function still allowed only `ACCEPTED`/`APPROVED`. It is replaced by hand
in the Supabase SQL editor with the same function, allowing `APPROVED`/`CONFIRMED`:

```sql
create or replace function public.submit_authenticated_venue_booking_request(
  p_venue_id uuid, p_event_id uuid, p_event_name text, p_booking_date date,
  p_slots text[], p_expected_attendees integer, p_room_layout text,
  p_required_facilities text[], p_accessibility_requirements text[],
  p_additional_requirements text, p_requested_by uuid
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_request_id uuid;
begin
  if p_requested_by is null then
    raise exception 'Verified requester is required';
  end if;

  -- Recheck the trusted event relationship inside the write transaction.
  perform 1 from public.events
    where id = p_event_id and coordinator_id = p_requested_by
      and status in ('APPROVED', 'CONFIRMED')
    for share;
  if not found then
    raise exception 'Event must be approved and assigned to this coordinator';
  end if;

  v_request_id := public.submit_venue_booking_request(
    p_venue_id, p_event_id, p_event_name, p_booking_date, p_slots,
    p_expected_attendees, p_room_layout, p_required_facilities,
    p_accessibility_requirements, p_additional_requirements
  );
  update public.venue_booking_requests
    set requested_by = p_requested_by where id = v_request_id;
  update public.venue_bookings
    set requested_by = p_requested_by::text where request_id = v_request_id;
  return v_request_id;
end;
$$;

revoke execute on function public.submit_authenticated_venue_booking_request(
  uuid, uuid, text, date, text[], integer, text, text[], text[], text, uuid
) from public, anon, authenticated;
grant execute on function public.submit_authenticated_venue_booking_request(
  uuid, uuid, text, date, text[], integer, text, text[], text[], text, uuid
) to service_role;
```

Before the earlier migration files were removed, this SQL was tested locally on PostgreSQL 17 with migrations 001-006,
including reapplication, preservation of legacy status values and constraints,
and denied booking writes. It has since been applied to the live Supabase
database (see the schema reference above for the later function update). Supabase SQL-editor/database access is required; the Auth admin key
used for the demo seed is not a general SQL executor. Existing live RLS must keep
business data behind the backend; browser SDK use is for Auth only.

Demo coordinator accounts 2 and 3 were created in the configured Supabase Auth
project; the existing coordinator and venue/technical accounts were preserved.
See [seed accounts](seed-users.md). No live business records were reassigned.

Run `npm test` and `npm run check` in `backend`; run `npm test -- --run`,
`npm run lint` and `npm run build` in `frontend`; run `npm run test:playwright`
from the repository root. Browser/API tests use isolated local Auth and storage;
they do not certify live Supabase policies.

## SCRUM-100: external client organiser scope

Event Organisers are the clients submitting event requests. Responsibility is
the existing `events.organiser_id`, not the coordinator's internal assignment.
An organiser may edit event details at any lifecycle status; the supplied AC
does not impose a status restriction. Saving preserves status, responsibility,
coordinator assignment and submission time. It does not reopen review or change bookings.

Each client organiser has one admin-controlled `app_metadata.organisation_id`
alongside their existing `roles: ["event_organiser"]`. Colleagues receive the
same nonblank identifier; unrelated clients receive different identifiers.
These identifiers describe client organisations, not staff departments. Email
identifies the account; neither its domain nor the organiser role establishes
organisation membership. Missing, blank or non-string membership grants only
own-event access. Do not group all organisers under one identifier.

On every organiser request the backend reads current Auth admin metadata and
paginates the directory to find fellow organisation members, then filters
`events.organiser_id` in the database. It returns no Auth directory or company
metadata. Lookup failures return safe 503 responses without widening scope.
User-editable `user_metadata`, URL parameters and request bodies cannot grant
membership. Trusted membership changes take effect on the next API request.
The event's organisation follows its submitting owner's current membership;
organisation transfers and historical membership are outside this story.

The `/my-event-requests` list groups own and colleague events under “Other organisers’
event requests”, with a same-company view-only explanation. Search filters
only the server-scoped list. Detail pages permit editing only with the verified
owner ID and update capability; the server independently enforces both.
A visible colleague edit returns 403. An invisible or missing record returns
the same 404 body. A changed owner between lookup and save returns 409 because
the UPDATE includes the owner predicate. Validation failures return 400 and
Auth/storage failures return 503; denied mutations do not alter any event field.

PATCH accepts a nonempty object containing only existing event-detail fields:
name, purpose, description, start_time, end_time, expected_attendance,
venue_requirements, accessibility_needs, equipment_needs and other_comments.
Protected or unknown fields reject the whole request. Partial edits reuse the
submission limits; unchanged past schedules do not block other edits. A changed
start must be future and the resulting end must follow start. The form sends
only changed fields, retaining original timestamps, including milliseconds,
when schedule fields are not changed. Failed edits retain input for correction.

### Schema reference and Auth setup (2026-10-05)

No new table, column, constraint or migration is needed for SCRUM-100. The
existing Auth metadata needs organisation identifiers, configured manually by
an administrator. This task has not modified the live database or Auth accounts.
See [seed users](seed-users.md#scrum-100-client-organisations) for exact demo setup.
For real accounts use their verified client membership, preserving existing roles.
Use the server-only [Auth admin update API](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid)
or the administrator's SQL editor; never the profile update API.

Use dedicated `event_organiser` accounts for the client lane. The user's intended
model separates client and staff accounts. Existing global multi-role policy is
unchanged by this story; combining organiser with attendee/staff roles would
grant those roles' independent permissions and is not this story's account setup.
Direct browser database access must remain blocked by existing RLS; isolated
API tests do not certify live RLS. Organisation lookup currently scans Auth users
per request, matching the existing admin-directory approach; this is adequate
for the course app, but larger deployments would need measured follow-up work.

### SCRUM-100 test evidence

See the existing [Access test guide](testing/frontend-acceptance.md#scrum-100-organiser-event-scope-2026-10-05) for the agreed cases, unit/integration/API/browser boundaries, standalone commands, full-row denied-write checks, latest regression results and measured coverage gaps. All new automated tests use isolated Auth/storage fixtures; live Supabase/RLS verification remains separate.
