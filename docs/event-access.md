# Event ownership and staff responsibilities

Coordinators are separate Supabase accounts with the same `event_coordinator`
role. `events.coordinator_id` determines whose planning workspace contains an
event. A role name, URL parameter, or submitted user ID never proves ownership.

| Account responsibility | Event access |
| --- | --- |
| Attendee | Browse events open for registration; manage only their own registrations |
| Event organiser | Submit requests and see their own requests and requirements |
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

The `/api/event-workspace` endpoints expose organiser-owned requests,
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
| `GET /api/event-workspace/organiser[/<id>]` | `events.own.read`; organiser_id = authenticated ID |
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

`tests/sql/event-review.assertions.sql` still asserts the 007 behaviour
(`ACCEPTED`, "must be accepted"); it is updated with 007's move.

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

`tests/sql/event-review.setup.sql` and `event-review.assertions.sql` are local
database test fixtures. Never run the setup script against an existing project.
For the historical isolated test procedure, retrieve migrations 001–006 from
the PR's pre-merge commit `efa6505` (Git history), then run setup, that historical
SQL, the retained 007 reference, and assertions using `psql -v ON_ERROR_STOP=1`.
The assertions roll back their changes. This historical procedure does not
validate staging's newer booking-decision SQL or the live database.
